import { useState } from "react";
import { Bell, X } from "lucide-react";
import type { Lead } from "@/lib/demo-data";

export function ScheduleDialog({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (date: string, title: string) => void }) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const [date, setDate] = useState(tomorrow.toISOString().slice(0, 10));
  const [time, setTime] = useState("11:30");
  const [title, setTitle] = useState("Customer follow-up");
  return <div className="overlay centered"><div className="modal">
    <header><div><span className="eyebrow">Schedule activity</span><h2>{lead.customerName}</h2></div><button aria-label="Close scheduling" onClick={onClose}><X size={19} /></button></header>
    <div className="form-grid"><label className="wide">Action title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Type<select><option>Call</option><option>WhatsApp</option><option>Email</option><option>Meeting</option><option>Bathroom audit</option></select></label><label>Duration<select><option>15 minutes</option><option>30 minutes</option><option>60 minutes</option></select></label><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><label className="wide">Note<textarea placeholder="What should you remember before contacting them?" /></label></div>
    <div className="reminder-line"><Bell size={17} /><div><strong>Two reminders</strong><span>1 day and 30 minutes before</span></div></div>
    <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave(new Date(`${date}T${time}:00+05:30`).toISOString(), title)}>Schedule follow-up</button></footer>
  </div></div>;
}
