import assert from "node:assert/strict";
import test from "node:test";
import type { OpportunityDto } from "./opportunities.types";

process.env.NEXT_PUBLIC_APP_ENV = "local";

const servicePromise = import("./opportunities.service");
const opportunity: OpportunityDto = {
  id: "872822016364622823",
  status: "UNCLAIMED",
  ownerId: null,
  fullName: "Mr. Pankaj Malik",
  phone: "(981) 106-8697",
  location: "Sec 62 Noida",
  interestedIn: null,
  consideringFor: "Myself",
  mainConcern: "Yes",
  preferredCallbackDay: null,
  preferredCallbackTime: "Tomorrow",
  summary: null,
  submittedAt: "2026-08-01T11:23:12Z",
  formContext: {
    "2": { order: "2", text: "Your Name", type: "control_textbox", answer: "Mr. Pankaj Malik" },
    "4": { order: "3", text: "Phone Number / Whatsapp No.", type: "control_phone", answer: { full: "(981) 106-8697" } },
    "22": { order: "6", text: "What is your main safety concern?", type: "control_checkbox", answer: ["Bathroom slips or falls"] },
    "23": { order: "9", text: "What would you like next?", type: "control_radio", answer: "Book a bathroom safety assessment" },
    "25": { order: "11", text: "Timings", type: "control_radio", answer: "Morning" },
  },
};

test("normalizes direct and data-wrapped opportunity lists", async () => {
  const { normalizeOpportunityList } = await servicePromise;
  assert.deepEqual(normalizeOpportunityList([opportunity]), [opportunity]);
  assert.deepEqual(normalizeOpportunityList({ data: [opportunity] }), [opportunity]);
});

test("normalizes Spring-style paged opportunity lists", async () => {
  const { normalizeOpportunityList } = await servicePromise;
  assert.deepEqual(normalizeOpportunityList({ data: { content: [opportunity] } }), [opportunity]);
  assert.deepEqual(normalizeOpportunityList({ content: [opportunity] }), [opportunity]);
});

test("maps the supplied backend DTO into the restored table model", async () => {
  const { mapOpportunityDto } = await servicePromise;
  const mapped = mapOpportunityDto(opportunity);
  assert.equal(mapped.id, "872822016364622823");
  assert.equal(mapped.status, "new");
  assert.equal(mapped.interest, "Book a bathroom safety assessment");
  assert.equal(mapped.summary, null);
  assert.deepEqual((mapped.formContext.formAnswers as Record<string, unknown>)["What is your main safety concern?"], ["Bathroom slips or falls"]);
  assert.equal((mapped.formContext.formAnswers as Record<string, unknown>)["Preferred time to contact"], "Tomorrow");
});

test("derives missing customer fields from the submitted form without crashing the table", async () => {
  const { mapOpportunityDto } = await servicePromise;
  const mapped = mapOpportunityDto({ ...opportunity, fullName: undefined, phone: undefined });
  assert.equal(mapped.fullName, "Mr. Pankaj Malik");
  assert.equal(mapped.phone, "(981) 106-8697");
});

test("rejects an unsafe numeric opportunity id before it can be used in a mutation", async () => {
  const { mapOpportunityDto } = await servicePromise;
  assert.throws(
    () => mapOpportunityDto({ ...opportunity, id: 872822016364622823 } as unknown as OpportunityDto),
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
    return Response.json({ data: [opportunity] });
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

test("requests the shared sales endpoint with a My Work tab and search", async () => {
  const originalFetch = globalThis.fetch;
  const { setApiAccessToken } = await import("../api/client");
  const { opportunitiesService } = await servicePromise;
  let request: { url: string; authorization: string | null } | undefined;

  setApiAccessToken("crm-user-access");
  globalThis.fetch = (async (input, init = {}) => {
    request = { url: String(input), authorization: new Headers(init.headers).get("authorization") };
    return new Response('{"status":"success","data":[{"id":872822017073460074,"customer":"Akasmat Pradhan","salesNextAction":"Call customer","salesNextActionAt":"2026-08-05T20:29:45.930649","lastUpdate":"2026-08-05T18:29:45.930649","status":"FOLLOW_UP","action":"Take action"}],"error":null}', {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.listSales("FOLLOW_UPS", "Akasmat Pradhan");
    assert.equal(result[0]?.status, "open");
    assert.equal(result[0]?.id, "872822017073460074");
    assert.equal(result[0]?.fullName, "Akasmat Pradhan");
    assert.equal(result[0]?.nextActionLabel, "Call customer");
    assert.equal(result[0]?.nextActionAt, "2026-08-05T20:29:45.930649");
    assert.equal(result[0]?.lastActionAt, "2026-08-05T18:29:45.930649");
    assert.equal(result[0]?.workGroup, "FOLLOW_UPS");
    assert.deepEqual(request, {
      url: "/sales/api/backend/crm/opportunities/all-sales?filter=FOLLOW_UPS&q=Akasmat%20Pradhan",
      authorization: "Bearer crm-user-access",
    });
  } finally {
    setApiAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});

test("groups SOLD My Work records under Closed while retaining the sold outcome", async () => {
  const { mapMyWorkOpportunityDto } = await servicePromise;
  const mapped = mapMyWorkOpportunityDto({
    id: "872822017073460075",
    customer: "Neha Jain",
    salesNextAction: null,
    salesNextActionAt: null,
    lastUpdate: "2026-08-05T18:29:58.198522",
    status: "SOLD",
    action: null,
  });
  assert.equal(mapped.status, "won");
  assert.equal(mapped.workGroup, "CLOSED");
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
  const responseBody = '{"status":"success","data":[{"id":872822017073460074,"customer":"Kavita Sharma","phone":"+91 98111 22334","location":"Gurugram","interestedIn":"Bathroom safety assessment","enquirySummary":"Worried about bathroom falls","ownerName":"Asha Mehta","salesNextAction":"Call customer","salesNextActionAt":"2026-08-06T11:00:00","lastUpdate":"2026-08-05T18:29:45","status":"FOLLOW_UP","action":"View"}],"error":null}';

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
    assert.equal(result[0]?.id, "872822017073460074");
    assert.equal(result[0]?.fullName, "Kavita Sharma");
    assert.equal(result[0]?.phone, "+91 98111 22334");
    assert.equal(result[0]?.location, "Gurugram");
    assert.equal(result[0]?.interest, "Bathroom safety assessment");
    assert.equal(result[0]?.summary, "Worried about bathroom falls");
    assert.equal(result[0]?.ownerName, "Asha Mehta");
    assert.equal(result[0]?.workGroup, "FOLLOW_UPS");
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
    return new Response('{"status":"success","data":{"id":872822017073460074,"status":"SOLD","ownerId":872822017000000001,"fullName":"Akasmat Pradhan","phone":"+91 98100 00000","location":"Noida","submittedAt":"2026-08-01T11:23:12","formContext":{"2":{"order":"2","text":"Your Name","answer":"Akasmat Pradhan"},"12":{"order":"8","text":"Brief description of concern","answer":"Bathroom safety assessment"}}},"error":null}', {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await opportunitiesService.getOpportunity("872822017073460074");
    assert.equal(result.id, "872822017073460074");
    assert.equal(result.ownerUserId, "872822017000000001");
    assert.equal(result.fullName, "Akasmat Pradhan");
    assert.equal(result.status, "won");
    assert.equal((result.formContext.formAnswers as Record<string, unknown>)["Brief description of concern"], "Bathroom safety assessment");
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
