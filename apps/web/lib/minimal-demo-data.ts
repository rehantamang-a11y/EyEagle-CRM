export type CrmHistory = { id: string; type: "imported" | "claimed" | "follow_up" | "sold" | "not_proceeding"; note?: string; lostReason?: string; nextActionAt?: string; at: string };
export type CrmOpportunity = {
  id: string; status: "new" | "open" | "won" | "lost"; ownerUserId?: string | null; ownerName?: string | null; fullName: string; phone: string; email?: string | null;
  location?: string | null; interest?: string | null; summary?: string | null; formContext: Record<string, unknown>; submittedAt: string;
  nextActionAt?: string | null; nextActionLabel?: string | null; lastActionAt?: string | null; lastNote?: string | null; closedAt?: string | null; lostReason?: string | null; history: CrmHistory[];
};

const now = new Date();
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
const form = (formAnswers: Record<string, string | string[]>) => ({ formAnswers });
const enquiryForm = (name: string, phone: string, location: string, consideringFor: string[], concerns: string[], immediate: "Yes" | "No", description: string, next: string, callback: string, timing: string) => form({
  "Your Name": name,
  "Phone Number / Whatsapp No.": phone,
  "Site name or location": location,
  "Who are you considering EyEagle for?": consideringFor,
  "What is your main safety concern?": concerns,
  "Any immediate safety concern?": immediate,
  "Brief description of concern": description,
  "What would you like next?": next,
  "Preferred time to contact": callback,
  "Timings": timing,
});

export const minimalDemoData: CrmOpportunity[] = [
  { id: "demo-1", status: "new", fullName: "Kavita Sharma", phone: "+91 98111 22334", location: "Gurugram", interest: "Book a bathroom safety assessment", summary: "Bathroom slips; lives with her mother", submittedAt: ago(2), formContext: enquiryForm("Kavita Sharma", "+91 98111 22334", "Gurugram", ["Senior parent / grandparent living in the same home"], ["Bathroom slips or falls", "Need bathroom grab bars / support"], "No", "My mother is independent, but I am worried about falls when nobody is at home.", "Book a bathroom safety assessment", "Tomorrow", "Morning"), history: [{ id: "h1", type: "imported", note: "Imported from Jotform", at: ago(2) }] },
  { id: "demo-2", status: "new", fullName: "Nitin Bansal", phone: "+91 98910 49000", location: "Delhi", interest: "Understand the EyEagle safety kit", summary: "Wants to understand the safety kit", submittedAt: ago(5), formContext: enquiryForm("Nitin Bansal", "+91 98910 49000", "Delhi", ["Senior parent / grandparent living away"], ["Need bathroom grab bars / support"], "No", "My father needs support getting in and out of the shower.", "Understand the EyEagle safety kit", "Day After Tomorrow", "Afternoon"), history: [{ id: "h2", type: "imported", note: "Imported from Jotform", at: ago(5) }] },
  { id: "demo-3", status: "open", ownerUserId: "me", ownerName: "Asha Mehta", fullName: "Rakesh Verma", phone: "+91 98711 66442", location: "Noida", interest: "Book a bathroom safety assessment", summary: "Needs a follow-up after speaking with family", submittedAt: ago(28), nextActionAt: ago(1), nextActionLabel: "Follow up", lastActionAt: ago(26), lastNote: "Spoke with Rakesh. He asked for a call after discussing it at home.", formContext: enquiryForm("Rakesh Verma", "+91 98711 66442", "Noida", ["Senior parent / grandparent living in the same home"], ["Bathroom slips or falls", "Night-time bathroom use"], "No", "The floor is slippery and there is a high step at the bathroom entrance.", "Book a bathroom safety assessment", "Tomorrow", "Evening"), history: [{ id: "h3", type: "follow_up", note: "Spoke with Rakesh. He asked for a call after discussing it at home.", nextActionAt: ago(1), at: ago(26) }] },
  { id: "demo-4", status: "open", ownerUserId: "user-rohan", ownerName: "Rohan Gupta", fullName: "Meera Iyer", phone: "+91 98100 77551", location: "South Delhi", interest: "Get pricing details", summary: "Interested in a kit for her aunt", submittedAt: ago(48), nextActionAt: later(28), nextActionLabel: "Follow up", lastActionAt: ago(3), lastNote: "Requested a call on Wednesday afternoon.", formContext: enquiryForm("Meera Iyer", "+91 98100 77551", "South Delhi", ["Someone recovering from illness or surgery"], ["Need bathroom grab bars / support", "Elderly person alone at home"], "No", "My aunt is recovering from surgery and needs simple bathroom support.", "Get pricing details", "This weekend", "Afternoon"), history: [{ id: "h4", type: "follow_up", note: "Requested a call on Wednesday afternoon.", nextActionAt: later(28), at: ago(3) }] },
  { id: "demo-5", status: "lost", ownerUserId: "user-priya", ownerName: "Priya Shah", fullName: "Anjali Rao", phone: "+91 98210 11899", location: "Delhi", interest: "Book a bathroom safety assessment", summary: "Enquiry closed", submittedAt: ago(96), closedAt: ago(10), lastActionAt: ago(10), lastNote: "They have decided not to proceed at this time.", lostReason: "Not interested", formContext: enquiryForm("Anjali Rao", "+91 98210 11899", "Delhi", ["Senior parent / grandparent living in the same home"], ["Need bathroom grab bars / support"], "No", "Would like additional support near the toilet for her grandmother.", "Book a bathroom safety assessment", "This weekend", "Morning"), history: [{ id: "h5", type: "not_proceeding", note: "They have decided not to proceed at this time.", lostReason: "Not interested", at: ago(10) }] },
];
