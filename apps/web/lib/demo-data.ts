export type Lead = {
  id: string; customerName: string; phone: string; city: string; source: string; summary: string;
  priority: "urgent"|"high"|"normal"|"low"; stage: string; ownerName?: string; status: string;
  createdAt: string; nextActivityAt?: string; lastContactedAt?: string; preferred?: string;
};
export type Activity = { id:string; leadId:string; customerName:string; phone:string; type:string; title:string; scheduledStart:string; status:"scheduled"|"overdue"|"completed"; note?:string };

// Fixed pilot seed time keeps server rendering and browser hydration identical.
// Production data comes from the API and does not use this clock.
const now = new Date("2026-08-02T07:30:00.000Z");
const at = (hour:number, minute=0, dayOffset=0) => { const d=new Date(now); d.setDate(d.getDate()+dayOffset); d.setHours(hour,minute,0,0); return d.toISOString(); };
const inMinutes = (minutes:number) => new Date(now.getTime()+minutes*60_000).toISOString();
export const initialLeads: Lead[] = [
  {id:"lead-1",customerName:"Mrs. Kavita Sharma",phone:"+91 98765 43210",city:"Gurugram",source:"Website",summary:"Bathroom safety assessment for her mother; daughter joins calls after 11 AM.",priority:"urgent",stage:"New Enquiry",status:"unclaimed",createdAt:at(8,12),preferred:"11:00 AM–1:00 PM"},
  {id:"lead-2",customerName:"Mr. Anand Iyer",phone:"+91 98110 24816",city:"Delhi",source:"Referral",summary:"Exploring fall detection for both parents. Asked about installation timeline.",priority:"high",stage:"New Enquiry",status:"unclaimed",createdAt:at(9,5),preferred:"After 2:00 PM"},
  {id:"lead-3",customerName:"Neena Kapoor",phone:"+91 98990 72514",city:"Noida",source:"Instagram",summary:"Requested a home audit and pricing details.",priority:"normal",stage:"New Enquiry",status:"unclaimed",createdAt:at(10,18),preferred:"Evening"},
  {id:"lead-4",customerName:"Colonel R. S. Bedi",phone:"+91 99718 10422",city:"Gurugram",source:"Event",summary:"Follow up after senior-living workshop. Interested in two bathrooms.",priority:"high",stage:"Interested",status:"active",ownerName:"Asha Mehta",createdAt:at(12,0,-4),lastContactedAt:at(16,40,-1),nextActivityAt:inMinutes(45)},
  {id:"lead-5",customerName:"Meera Nair",phone:"+91 99201 34882",city:"Delhi",source:"Website",summary:"Daughter is comparing packages for parents in Vasant Kunj.",priority:"normal",stage:"Decision Pending",status:"active",ownerName:"Asha Mehta",createdAt:at(12,0,-8),lastContactedAt:at(14,10,-2),nextActivityAt:inMinutes(180)},
  {id:"lead-6",customerName:"Sanjay Malhotra",phone:"+91 98104 11029",city:"Noida",source:"Phone",summary:"Audit completed; proposal needs to be shared with the family group.",priority:"normal",stage:"Audit Completed",status:"active",ownerName:"Asha Mehta",createdAt:at(12,0,-11),lastContactedAt:at(12,15,-3)},
  {id:"lead-7",customerName:"Dr. Leela Menon",phone:"+91 98911 60555",city:"Delhi",source:"Referral",summary:"Waiting on son to confirm an audit date.",priority:"low",stage:"Connected",status:"active",ownerName:"Asha Mehta",createdAt:at(12,0,-14),lastContactedAt:at(17,30,-7),nextActivityAt:at(10,30,1)},
];
export const initialActivities: Activity[] = [
  {id:"act-1",leadId:"lead-4",customerName:"Colonel R. S. Bedi",phone:"+91 99718 10422",type:"Call",title:"Confirm audit availability",scheduledStart:inMinutes(45),status:"scheduled",note:"Son will join the call."},
  {id:"act-2",leadId:"lead-5",customerName:"Meera Nair",phone:"+91 99201 34882",type:"WhatsApp",title:"Send package comparison",scheduledStart:inMinutes(180),status:"scheduled",note:"Send the simple two-option comparison."},
  {id:"act-3",leadId:"lead-6",customerName:"Sanjay Malhotra",phone:"+91 98104 11029",type:"Send proposal",title:"Share proposal with family",scheduledStart:inMinutes(-35),status:"overdue",note:"Include bathroom audit notes."},
  {id:"act-4",leadId:"lead-7",customerName:"Dr. Leela Menon",phone:"+91 98911 60555",type:"Call",title:"Confirm family decision",scheduledStart:at(10,30,1),status:"scheduled"},
];
export const stages=["New Enquiry","Picked Up","Contact Attempted","Connected","Interested","Audit Scheduled","Audit Completed","Proposal Shared","Decision Pending","Won","Lost","Do Not Contact"];
