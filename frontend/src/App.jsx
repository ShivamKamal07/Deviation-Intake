import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  dismissError, loadOptions, loadSaved, resetForm, saveDeviation, sendToAssistant, updateField,
} from "./deviationSlice";

const REQUIRED = ["site", "date_of_occurrence", "title", "source", "description", "impact", "severity"];
const SITES = ["API Manufacturing Unit", "API Unit II", "Quality Control Lab"];

function Field({ label, name, required, children, wide }) {
  const { missing, unlocked, changed } = useSelector((s) => s.deviation);
  const flagged = unlocked && missing.includes(name);
  const updated = changed.includes(name);
  return (
    <label className={`field ${wide ? "wide" : ""} ${flagged ? "flagged" : ""} ${updated ? "updated" : ""}`}>
      <span>{label}{required && <b> *</b>}</span>
      {children}
      {flagged && <em>Not found in the document. Please fill this in.</em>}
    </label>
  );
}

function LogForm() {
  const d = useDispatch();
  const { form, unlocked, options, status, error, lastSaved } = useSelector((s) => s.deviation);
  const bind = (name) => ({
    value: form[name] ?? "",
    disabled: !unlocked,
    onChange: (e) => d(updateField({ name, value: e.target.value })),
  });
  const complete = REQUIRED.every((k) => form[k]);
  const sites = form.site && !SITES.includes(form.site) ? [form.site, ...SITES] : SITES;

  return (
    <section className="card form">
      <header>
        <div>
          <h1>Log Deviation</h1>
          <p className="muted">Record any unexpected event, out-of-specification result or non-conformance.</p>
        </div>
        <span className={`pill ${status === "saved" ? "ok" : ""}`}>{status === "saved" ? "Saved" : "Draft"}</span>
      </header>

      {!unlocked && <div className="hint">The form is filled by the AI Deviation Assistant on the right. Type or paste the deviation details, or add a document, to start.</div>}
      {lastSaved && status === "saved" && <div className="banner ok">Saved as <b>{lastSaved.deviation_no}</b>.</div>}
      {error && <div className="banner err" onClick={() => d(dismissError())}>{error}</div>}

      <h2>Deviation information</h2>
      <div className="grid">
        <Field label="Site / Plant" name="site" required>
          <select {...bind("site")}><option value="">Select site</option>{sites.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Date of occurrence" name="date_of_occurrence" required>
          <input type="date" {...bind("date_of_occurrence")} />
        </Field>
        <Field label="Title / short description" name="title" required>
          <input maxLength={200} placeholder="e.g. OOS result for Assay in Batch ABC-001" {...bind("title")} />
        </Field>
        <Field label="Source" name="source" required>
          <select {...bind("source")}><option value="">Select source</option>{options.sources.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Related product / material" name="product">
          <input placeholder="Product or material" {...bind("product")} />
        </Field>
        <Field label="Batch / lot number" name="batch_number">
          <input placeholder="Batch / lot no." {...bind("batch_number")} />
        </Field>
      </div>

      <h2>Deviation details</h2>
      <div className="grid">
        <Field label="Detailed description" name="description" required wide>
          <textarea rows={5} maxLength={2000} placeholder="What happened, where, when and how it was detected" {...bind("description")} />
          <small className="count">{form.description.length}/2000</small>
        </Field>
        <Field label="Initial impact" name="impact" required>
          <select {...bind("impact")}><option value="">Select impact</option>{options.impacts.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Initial severity" name="severity" required>
          <select {...bind("severity")}><option value="">Select severity</option>{options.severities.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
      </div>

      {unlocked && form.ai_reason && (
        <div className={`reason sev-${(form.severity || "").toLowerCase()}`}>
          <b>AI recommendation: {form.severity || "n/a"} severity, {form.impact || "impact n/a"}</b>
          <p>{form.ai_reason}</p>
          <small>Suggestion only. Change the fields above if you disagree.</small>
        </div>
      )}

      <footer>
        <button className="ghost" onClick={() => d(resetForm())}>Reset form</button>
        <button className="primary" disabled={!unlocked || !complete || status === "saving"} onClick={() => d(saveDeviation())}>
          {status === "saving" ? "Saving…" : "Save deviation"}
        </button>
      </footer>
    </section>
  );
}

function Assistant() {
  const d = useDispatch();
  const { messages, chatBusy, extracting } = useSelector((s) => s.deviation);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef();
  const endRef = useRef();
  const busy = chatBusy;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const run = () => { d(sendToAssistant({ message: text.trim(), file, forceExtract: true })); setText(""); setFile(null); setPasteOpen(false); };
  const pick = (f) => { if (f) setFile(f); };
  const send = () => { if (q.trim() && !chatBusy) { d(sendToAssistant({ message: q.trim() })); setQ(""); } };

  return (
    <aside className="card assistant">
      <header>
        <h2 className="title">AI Deviation Assistant</h2>
        <span className="pill beta">Beta</span>
      </header>

      <div
        className={`drop ${drag ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
      >
        {file ? (
          <p><b>{file.name}</b> <button className="link" onClick={() => setFile(null)}>Remove</button></p>
        ) : (
          <p>Drag and drop a supporting document here, or <button className="link" onClick={() => inputRef.current.click()}>click to browse</button></p>
        )}
        <input ref={inputRef} hidden type="file" accept=".pdf,.docx,.txt,.xlsx,.eml" onChange={(e) => pick(e.target.files[0])} />
      </div>
      <p className="formats">PDF, DOCX, XLSX, TXT or email text. Max 10 MB.</p>

      <div className="or">or</div>
      <button className="paste" onClick={() => setPasteOpen(!pasteOpen)}>{pasteOpen ? "Hide pasted text" : "Paste deviation details / notes"}</button>
      {pasteOpen && <textarea className="pasted" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the email, lab notes or event description here" />}

      <button className="primary full" disabled={busy || (!file && text.trim().length < 20)} onClick={run}>
        {busy ? "Extracting…" : "Extract with AI"}
      </button>

      {extracting && (
        <div className="progress"><div className="bar" />
          <p>Reading the document, extracting details, then assessing impact and severity. This can take a few seconds.</p>
        </div>
      )}

      <div className="chat">
        {messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.file ? `Attached: ${m.file}` : m.text}</div>)}
        {chatBusy && !extracting && <div className="msg ai">Thinking…</div>}
        <div ref={endRef} />
      </div>

      <div className="ask">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask anything about deviations…" />
        <button className="primary" aria-label="Send" onClick={send}>Send</button>
      </div>
      <small className="muted center">AI responses may contain errors. Please verify information.</small>
    </aside>
  );
}

function Recent() {
  const saved = useSelector((s) => s.deviation.saved);
  if (!saved.length) return null;
  return (
    <section className="card recent">
      <h2 className="title">Recently logged</h2>
      <table>
        <thead><tr><th>No.</th><th>Title</th><th>Batch</th><th>Impact</th><th>Severity</th></tr></thead>
        <tbody>{saved.slice(0, 5).map((r) => (
          <tr key={r.id}><td>{r.deviation_no}</td><td>{r.title}</td><td>{r.batch_number || "-"}</td><td>{r.impact}</td><td><span className={`sev sev-${r.severity.toLowerCase()}`}>{r.severity}</span></td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export default function App() {
  const d = useDispatch();
  useEffect(() => { d(loadOptions()); d(loadSaved()); }, [d]);
  return (
    <>
      <nav><b className="brand">AIVOA</b><span>QMS</span><span>Dashboard</span><span className="on">Deviations</span><span>CAPAs</span><span>Change Control</span><span>Audits</span></nav>
      <main>
        <LogForm />
        <Assistant />
        <Recent />
      </main>
    </>
  );
}
