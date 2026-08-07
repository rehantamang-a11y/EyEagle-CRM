import assert from "node:assert/strict";
import test from "node:test";
import type { JotformOpportunityListDto, OpportunityDetailDto } from "./opportunities.types";

process.env.NEXT_PUBLIC_APP_ENV = "local";

const servicePromise = import("./opportunities.service");
const opportunity: OpportunityDetailDto = {
  id: "872822016364622823",
  status: "UNCLAIMED",
  customerName: "Mr. Pankaj Malik",
  phone: "(981) 106-8697",
  email: null,
  location: "Sec 62 Noida",
  interestedIn: "Book a bathroom safety assessment",
  consideringFor: "Myself",
  safetyConcern: ["Bathroom slips or falls"],
  immediateConcern: "Yes",
  description: null,
  preferredDay: "Tomorrow",
  preferredTiming: "Morning",
  source: "Jotform",
  owner: null,
  submittedAt: "2026-08-01T11:23:12Z",
  formSubmission: [{ question: "I agree to be contacted about this request.", answer: "Accepted" }],
};

const listOpportunity: JotformOpportunityListDto = {
  ...opportunity,
  status: "UNCLAIMED",
  action: "Take ownership",
  formContext: {
    "2": { name: "q2_textbox0", text: "Your Name", answer: "Mr. Pankaj Malik" },
    "4": { name: "q4_phone2", text: "Phone Number / Whatsapp No.", answer: { full: "(981) 106-8697" } },
    "10": { name: "q10_textbox8", text: "Site name or location", answer: "Sec 62 Noida" },
    "11": { name: "q11_radio9", text: "Any immediate safety concern?", answer: "Yes" },
    "12": { name: "q12_textarea10", text: "Brief description of concern" },
    "14": { name: "q14_widget_TermsAndConditions12", text: "I agree to be contacted about this request.", answer: "Accepted" },
    "21": { name: "whoAre", text: "Who are you considering EyEagle for?", answer: ["Myself"] },
    "22": { name: "whatIs", text: "What is your main safety concern?", answer: ["Bathroom slips or falls"] },
    "23": { name: "whatWould", text: "What would you like next?", answer: "Book a bathroom safety assessment" },
    "24": { name: "preferredTime", text: "Preferred time to contact", answer: "Tomorrow" },
    "25": { name: "timings", text: "Timings", answer: "Morning" },
  },
};

test("normalizes direct and data-wrapped opportunity lists", async () => {
  const { normalizeOpportunityList } = await servicePromise;
  assert.deepEqual(normalizeOpportunityList([listOpportunity]), [listOpportunity]);
  assert.deepEqual(normalizeOpportunityList({ data: [listOpportunity] }), [listOpportunity]);
});

test("normalizes Spring-style paged opportunity lists", async () => {
  const { normalizeOpportunityList } = await servicePromise;
  assert.deepEqual(normalizeOpportunityList({ data: { content: [listOpportunity] } }), [listOpportunity]);
  assert.deepEqual(normalizeOpportunityList({ content: [listOpportunity] }), [listOpportunity]);
});

test("maps the supplied backend DTO into the restored table model", async () => {
  const { mapOpportunityDetailDto } = await servicePromise;
  const mapped = mapOpportunityDetailDto(opportunity);
  assert.equal(mapped.id, "872822016364622823");
  assert.equal(mapped.status, "UNCLAIMED");
  assert.equal(mapped.interest, "Book a bathroom safety assessment");
  assert.equal(mapped.summary, null);
  assert.deepEqual(mapped.formAnswers["What is your main safety concern?"], ["Bathroom slips or falls"]);
  assert.equal(mapped.formAnswers["Preferred time to contact"], "Tomorrow");
  assert.equal(mapped.formAnswers["I agree to be contacted about this request."], "Accepted");
});

test("maps opportunity list table values from formContext instead of flat detail keys", async () => {
  const { mapOpportunityListDto } = await servicePromise;
  const { OPPORTUNITY_FORM_FIELDS } = await import("./opportunity-form");
  const mapped = mapOpportunityListDto({
    ...listOpportunity,
    customerName: "Incorrect flat name",
    interestedIn: "Incorrect flat interest",
    formData: {},
    formContext: {
      "2": { name: "q2_textbox0", text: "Your Name", answer: "shubham meena" },
      "4": { name: "q4_phone2", text: "Phone Number / Whatsapp No.", answer: { full: "(770) 407-1095" } },
      "10": { name: "q10_textbox8", text: "Site name or location", answer: "Faridabad" },
      "11": { name: "q11_radio9", text: "Any immediate safety concern?", answer: "Yes" },
      "12": { name: "q12_textarea10", text: "Brief description of concern", answer: "Kids using the bathroom." },
      "14": { name: "q14_widget_TermsAndConditions12", text: "I agree to be contacted about this request.", answer: "Accepted" },
      "21": { name: "whoAre", text: "Who are you considering EyEagle for?", answer: ["General home safety"] },
      "22": { name: "whatIs", text: "What is your main safety concern?", answer: ["Not sure, just exploring"] },
      "23": { name: "whatWould", text: "What would you like next?", answer: "Understand the EyEagle safety kit" },
      "24": { name: "preferredTime", text: "Preferred time to contact", answer: "This weekend" },
      "25": { name: "timings", text: "Timings", answer: "Afternoon" },
    },
  });
  const answers = mapped.formAnswers;

  assert.deepEqual(Object.keys(answers), OPPORTUNITY_FORM_FIELDS.map(({ label }) => label));
  assert.equal(mapped.fullName, "shubham meena");
  assert.equal(mapped.phone, "(770) 407-1095");
  assert.equal(mapped.location, "Faridabad");
  assert.equal(mapped.interest, "Understand the EyEagle safety kit");
  assert.equal(mapped.summary, "Kids using the bathroom.");
  assert.equal(answers["Your Name"], "shubham meena");
  assert.equal(answers["Phone Number / Whatsapp No."], "(770) 407-1095");
  assert.equal(answers["Site name or location"], "Faridabad");
  assert.deepEqual(answers["Who are you considering EyEagle for?"], ["General home safety"]);
  assert.deepEqual(answers["What is your main safety concern?"], ["Not sure, just exploring"]);
  assert.equal(answers["Any immediate safety concern?"], "Yes");
  assert.equal(answers["Brief description of concern"], "Kids using the bathroom.");
  assert.equal(answers["What would you like next?"], "Understand the EyEagle safety kit");
  assert.equal(answers["Preferred time to contact"], "This weekend");
  assert.equal(answers["Timings"], "Afternoon");
  assert.equal(answers["I agree to be contacted about this request."], "Accepted");
  assert.ok(mapped.formValidationIssues?.some((issue) => issue.includes("customerName")));
  assert.ok(mapped.formValidationIssues?.some((issue) => issue.includes("interestedIn")));
});

test("uses nested prettyFormat fallback and flags a populated flat key when the form answer is missing", async () => {
  const { mapOpportunityListDto } = await servicePromise;
  const mapped = mapOpportunityListDto({
    ...listOpportunity,
    description: "Flat description must not populate the table",
    formContext: {
      ...listOpportunity.formContext,
      "4": { name: "q4_phone2", text: "Phone Number / Whatsapp No.", answer: "", prettyFormat: "(770) 407-1095" },
      "12": { name: "q12_textarea10", text: "Brief description of concern" },
    },
  });

  assert.equal(mapped.phone, "(770) 407-1095");
  assert.equal(mapped.summary, null);
  assert.equal(mapped.formAnswers["Brief description of concern"], "Not answered");
  assert.ok(mapped.formValidationIssues?.some((issue) => issue.startsWith("description ")));
});

test("derives missing customer fields from the submitted form without crashing the table", async () => {
  const { mapOpportunityDetailDto } = await servicePromise;
  const mapped = mapOpportunityDetailDto(opportunity);
  assert.equal(mapped.fullName, "Mr. Pankaj Malik");
  assert.equal(mapped.phone, "(981) 106-8697");
});

test("maps named opportunity-detail fields back to their Jotform questions", async () => {
  const { mapOpportunityDetailDto } = await servicePromise;
  const mapped = mapOpportunityDetailDto({
    id: "872822017073460074",
    customerName: "Akasmat Pradhan",
    phone: "(856) 406-1724",
    email: null,
    location: "Khatima / Delhi / Odisha - will confirm location shortly",
    submittedAt: "2026-05-18T02:24:31",
    consideringFor: "Senior parent / grandparent living away, Someone recovering from illness or surgery",
    safetyConcern: "No",
    immediateConcern: null,
    interestedIn: null,
    preferredDay: null,
    preferredTiming: "Tomorrow",
    description: null,
    owner: { id: "872771631951840242", name: "Akshat S" },
    source: "Jotform",
  });
  const answers = mapped.formAnswers;

  assert.equal(Object.keys(answers).length, 11);
  assert.equal(answers["Your Name"], "Akasmat Pradhan");
  assert.equal(answers["Phone Number / Whatsapp No."], "(856) 406-1724");
  assert.equal(answers["Site name or location"], "Khatima / Delhi / Odisha - will confirm location shortly");
  assert.equal(answers["Who are you considering EyEagle for?"], "Senior parent / grandparent living away, Someone recovering from illness or surgery");
  assert.equal(answers["What is your main safety concern?"], "No");
  assert.equal(answers["Any immediate safety concern?"], "Not answered");
  assert.equal(answers["Brief description of concern"], "Not answered");
  assert.equal(answers["What would you like next?"], "Not answered");
  assert.equal(answers["Preferred time to contact"], "Not answered");
  assert.equal(answers.Timings, "Tomorrow");
  assert.equal(answers["I agree to be contacted about this request."], "Not answered");
  assert.equal(mapped.ownerUserId, "872771631951840242");
  assert.equal(mapped.ownerName, "Akshat S");
});

test("rejects an unsafe numeric opportunity id before it can be used in a mutation", async () => {
  const { mapOpportunityDetailDto } = await servicePromise;
  assert.throws(
    () => mapOpportunityDetailDto({ ...opportunity, id: 872822016364622823 } as unknown as OpportunityDetailDto),
    /backend must serialize opportunity IDs as JSON strings/,
  );
});

test("requests the authenticated unclaimed opportunities endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; authorization: string | null } | undefined;

  setApiAccessToken("crm-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), authorization: new Headers(init.headers).get("authorization") };
    return Response.json({ data: [listOpportunity] });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.listUnclaimed();
    assert.equal(result[0]?.id, "872822016364622823");
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities?view=unclaimed",
      authorization: "Bearer crm-access",
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("requests the dedicated My Work endpoint without backend filters or search", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; authorization: string | null } | undefined;

  setApiAccessToken("crm-user-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), authorization: new Headers(init.headers).get("authorization") };
    return new Response('{"status":"success","data":[{"id":872822017073460074,"customer":"Akasmat Pradhan","salesNextAction":"Call customer","salesNextActionAt":"2026-08-05T20:29:45.930649","lastUpdatedAt":"2026-08-05T18:29:45.930649","status":"FOLLOW_UP","action":"Take action"}],"error":null}', {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.listMyWork();
    assert.equal(result[0]?.status, "FOLLOW_UP");
    assert.equal(result[0]?.id, "872822017073460074");
    assert.equal(result[0]?.fullName, "Akasmat Pradhan");
    assert.equal(result[0]?.nextActionLabel, "Call customer");
    assert.equal(result[0]?.nextActionAt, "2026-08-05T20:29:45.930649");
    assert.equal(result[0]?.lastActionAt, "2026-08-05T18:29:45.930649");
    assert.equal(result[0]?.workGroup, "FOLLOW_UPS");
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities/my-work",
      authorization: "Bearer crm-user-access",
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("groups every My Work status into the correct frontend tab", async () => {
  const { mapMyWorkOpportunityDto } = await servicePromise;
  const mapStatus = (status: string) => mapMyWorkOpportunityDto({
    id: `status-${status}`,
    customer: "Customer",
    status,
  });

  assert.equal(mapStatus("DUE").workGroup, "DUE");
  assert.equal(mapStatus("FOLLOW_UP").workGroup, "FOLLOW_UPS");
  assert.equal(mapStatus("NOT_PROCEEDING").workGroup, "CLOSED");
  assert.equal(mapStatus("NOT_PROCEEDING").status, "NOT_PROCEEDING");
  assert.equal(mapStatus("SOLD").workGroup, "CLOSED");
  assert.equal(mapStatus("SOLD").status, "SOLD");
  assert.equal(mapStatus("SOLD").formAnswers["What is your main safety concern?"], "Not answered");
});

test("maps compact All Sales statuses without inventing unavailable customer details", async () => {
  const { mapAllSalesOpportunityDto } = await servicePromise;
  const open = mapAllSalesOpportunityDto({ id: "all-open", customer: "Harshit", owner: "Akshat S", status: "OPEN" });
  const lost = mapAllSalesOpportunityDto({ id: "all-lost", customer: "Akasmat Pradhan", owner: "Akshat S", status: "NOT_PROCEEDING" });
  const sold = mapAllSalesOpportunityDto({ id: "all-sold", customer: "Neha Jain", owner: "Akshat S", status: "SOLD" });

  assert.equal(open.status, "OPEN");
  assert.equal(open.ownerName, "Akshat S");
  assert.equal(open.phone, "Phone not provided");
  assert.equal(open.location, null);
  assert.equal(lost.status, "NOT_PROCEEDING");
  assert.equal(sold.status, "SOLD");
});

test("passes every sales tab enum to the backend", async () => {
  const originalFetch = globalThis.fetch;
  const { opportunitiesService } = await servicePromise;
  const requests: string[] = [];

  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return new Response('{"status":"success","data":[],"error":null}', {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    for (const filter of ["ALL", "DUE", "FOLLOW_UPS", "CLOSED"] as const) {
      await opportunitiesService.listSales(filter);
    }
    assert.deepEqual(requests, [
      "/sales/api/backend/crm/opportunities/all-sales?filter=ALL",
      "/sales/api/backend/crm/opportunities/all-sales?filter=DUE",
      "/sales/api/backend/crm/opportunities/all-sales?filter=FOLLOW_UPS",
      "/sales/api/backend/crm/opportunities/all-sales?filter=CLOSED",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searches the shared sales table across supported fields with exact URI encoding", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const responseBody = '{"status":"success","data":[{"id":872822017048294264,"customer":"Dr Ritika Caroli","owner":"Akshat S","salesNextAction":"Call customer","salesNextActionAt":"2026-08-06T15:06:59.28613","lastUpdatedAt":"2026-08-06T13:06:59.28613","status":"OPEN","action":"View"}],"error":null}';

  setApiAccessToken("crm-admin-access");
  globalThis.fetch = (async (input, init = {}) => {
    requests.push({ url: String(input), authorization: new Headers(init.headers).get("authorization") });
    return new Response(responseBody, { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const searches = [
      "",
      "Kavita Sharma",
      "+91 98111 22334",
      "Gurugram",
      "Bathroom safety assessment",
      "Worried about bathroom falls",
      "Asha Mehta",
    ];
    let result = await opportunitiesService.listSales("ALL", searches[0]);
    for (const search of searches.slice(1)) result = await opportunitiesService.listSales("ALL", search);

    assert.deepEqual(requests, [
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL", authorization: "Bearer crm-admin-access" },
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL&q=Kavita%20Sharma", authorization: "Bearer crm-admin-access" },
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL&q=%2B91%2098111%2022334", authorization: "Bearer crm-admin-access" },
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL&q=Gurugram", authorization: "Bearer crm-admin-access" },
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL&q=Bathroom%20safety%20assessment", authorization: "Bearer crm-admin-access" },
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL&q=Worried%20about%20bathroom%20falls", authorization: "Bearer crm-admin-access" },
      { url: "/sales/api/backend/crm/opportunities/all-sales?filter=ALL&q=Asha%20Mehta", authorization: "Bearer crm-admin-access" },
    ]);
    assert.equal(result[0]?.id, "872822017048294264");
    assert.equal(result[0]?.fullName, "Dr Ritika Caroli");
    assert.equal(result[0]?.phone, "Phone not provided");
    assert.equal(result[0]?.location, null);
    assert.equal(result[0]?.interest, null);
    assert.equal(result[0]?.summary, null);
    assert.equal(result[0]?.ownerName, "Akshat S");
    assert.equal(result[0]?.status, "OPEN");
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("fetches and maps one opportunity's authoritative details", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; authorization: string | null } | undefined;

  setApiAccessToken("crm-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), authorization: new Headers(init.headers).get("authorization") };
    return new Response('{"status":"success","data":{"id":872822017073460074,"owner":{"id":872822017000000001,"name":"Akshat S"},"customerName":"Akasmat Pradhan","phone":"+91 98100 00000","email":null,"location":"Noida","consideringFor":"Myself","safetyConcern":"Bathroom slips or falls","immediateConcern":"No","description":"Bathroom safety assessment","interestedIn":"Understand the EyEagle safety kit","preferredDay":"This weekend","preferredTiming":"Morning","submittedAt":"2026-08-01T11:23:12","source":"Jotform","formSubmission":[{"question":"What is your main safety concern?","answer":["Conflicting formSubmission value"]},{"question":"I agree to be contacted about this request.","answer":"Accepted"}],"activityHistory":[]},"error":null}', {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.getOpportunity("872822017073460074");
    assert.equal(result.id, "872822017073460074");
    assert.equal(result.ownerUserId, "872822017000000001");
    assert.equal(result.fullName, "Akasmat Pradhan");
    assert.equal(result.status, "OPEN");
    assert.equal(result.ownerName, "Akshat S");
    assert.equal(result.source, "Jotform");
    assert.equal(Object.keys(result.formAnswers).length, 11);
    assert.equal(result.formAnswers["Your Name"], "Akasmat Pradhan");
    assert.equal(result.formAnswers["Phone Number / Whatsapp No."], "+91 98100 00000");
    assert.equal(result.formAnswers["Site name or location"], "Noida");
    assert.equal(result.formAnswers["Who are you considering EyEagle for?"], "Myself");
    assert.equal(result.formAnswers["Brief description of concern"], "Bathroom safety assessment");
    assert.equal(result.formAnswers["What is your main safety concern?"], "Bathroom slips or falls");
    assert.equal(result.formAnswers["Any immediate safety concern?"], "No");
    assert.equal(result.formAnswers["What would you like next?"], "Understand the EyEagle safety kit");
    assert.equal(result.formAnswers["Preferred time to contact"], "This weekend");
    assert.equal(result.formAnswers.Timings, "Morning");
    assert.equal(result.formAnswers["I agree to be contacted about this request."], "Accepted");
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities/872822017073460074",
      authorization: "Bearer crm-access",
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("posts the authenticated Jotform sync endpoint without a request body", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; method?: string; authorization: string | null; body?: BodyInit | null } | undefined;

  setApiAccessToken("crm-admin-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), method: init.method, authorization: new Headers(init.headers).get("authorization"), body: init.body };
    return Response.json({ data: { scanned: 4, imported: 2, issues: 0 } });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.syncJotform();
    assert.equal(result.imported, 2);
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/jotform/sync",
      method: "POST",
      authorization: "Bearer crm-admin-access",
      body: undefined,
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("posts the authenticated ownership endpoint with the string opportunity id", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; method?: string; authorization: string | null; body?: BodyInit | null } | undefined;

  setApiAccessToken("crm-user-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), method: init.method, authorization: new Headers(init.headers).get("authorization"), body: init.body };
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await opportunitiesService.takeOwnership("872822016364622823");
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities/872822016364622823/ownership",
      method: "POST",
      authorization: "Bearer crm-user-access",
      body: undefined,
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("posts an authenticated opportunity action with the exact backend payload", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; method?: string; authorization: string | null; contentType: string | null; body?: BodyInit | null } | undefined;

  setApiAccessToken("crm-user-access");
  globalThis.fetch = (async (input, init = {}) => {
    const headers = new Headers(init.headers);
    request = {
      url: String(input),
      method: init.method,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: init.body,
    };
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await opportunitiesService.saveAction("872822017073460074", {
      outcome: "FOLLOW_UP",
      nextFollowUp: "2026-08-06T11:00:00",
      reason: null,
      callSummary: "Customer requested a follow-up tomorrow morning.",
    });
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities/872822017073460074/actions",
      method: "POST",
      authorization: "Bearer crm-user-access",
      contentType: "application/json",
      body: JSON.stringify({
        outcome: "FOLLOW_UP",
        nextFollowUp: "2026-08-06T11:00:00",
        reason: null,
        callSummary: "Customer requested a follow-up tomorrow morning.",
      }),
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("fetches and maps opportunity action history", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; authorization: string | null } | undefined;

  setApiAccessToken("crm-user-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), authorization: new Headers(init.headers).get("authorization") };
    return new Response('{"status":"success","data":[{"id":872822017073460099,"outcome":"FOLLOW_UP","nextFollowUp":"2026-08-06T11:00:00","reason":null,"callSummary":"Customer requested a call tomorrow.","createdAt":"2026-08-05T18:29:45.930649"}],"error":null}', {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.listActionHistory("872822017073460074");
    assert.deepEqual(result[0], {
      id: "872822017073460099",
      type: "follow_up",
      note: "Customer requested a call tomorrow.",
      lostReason: undefined,
      nextActionAt: "2026-08-06T11:00:00",
      at: "2026-08-05T18:29:45.930649",
    });
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities/872822017073460074/actions",
      authorization: "Bearer crm-user-access",
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});
