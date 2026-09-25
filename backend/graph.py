"""LangGraph workflow for the AI Deviation Assistant.

One graph handles every message the user sends from the AI panel:

    route ──► extract ─► assess ─► normalize ─► END     (new deviation text / document)
      │
      ├────► update ─► END                              (correction: "sorry, batch is BMX...")
      │
      └────► answer ─► END                              (general question, plain text reply)

The graph returns {intent, reply, fields, changed, missing} and the frontend
just applies it to the Redux form.
"""
import json
import os
from datetime import date
from typing import TypedDict, List

from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END

load_dotenv()

SOURCES = ["Customer Complaint", "OOS Result", "Process Parameter Excursion", "Equipment Failure",
           "Audit Finding", "Operator Error", "Environmental Monitoring", "Other"]
IMPACTS = ["Product Quality", "Patient Safety", "Regulatory Compliance", "Process / Equipment",
           "Data Integrity", "EHS"]
SEVERITIES = ["Low", "Medium", "High", "Critical"]
MANDATORY = ["site", "date_of_occurrence", "title", "source", "description", "impact", "severity"]
EDITABLE = ["site", "date_of_occurrence", "title", "source", "product", "batch_number",
            "description", "impact", "severity"]
MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

_json_llm = None
_text_llm = None


def json_llm():
    global _json_llm
    if _json_llm is None:
        _json_llm = ChatGroq(model=MODEL, temperature=0).bind(response_format={"type": "json_object"})
    return _json_llm


def text_llm():
    global _text_llm
    if _text_llm is None:
        _text_llm = ChatGroq(model=MODEL, temperature=0.2)
    return _text_llm


class State(TypedDict, total=False):
    message: str          # what the user typed
    doc_text: str         # text pulled from an uploaded file
    form: dict            # current form values on screen
    force_extract: bool   # the "Extract with AI" button was used
    intent: str
    fields: dict
    changed: List[str]
    missing: List[str]
    reply: str
    date_assumed: bool


def _ask_json(system: str, user: str) -> dict:
    resp = json_llm().invoke([("system", system), ("user", user)])
    try:
        return json.loads(resp.content)
    except json.JSONDecodeError:
        return {}


def _form_is_empty(form: dict) -> bool:
    return not any((form or {}).get(k) for k in ("title", "description", "batch_number", "product"))


# ---------- routing ----------
def route_node(state: State) -> State:
    if state.get("force_extract") or state.get("doc_text"):
        return {"intent": "extract"}
    system = """Classify the user's message for a deviation-logging assistant. Return ONLY JSON: {"intent": "..."}.
- "extract": the message describes a new event/deviation/complaint to be logged (facts like product, batch, what happened).
- "update": the form is already filled and the user is correcting or adding specific field values.
- "question": a general question or chat, not data to log.
If form_filled is false, "update" is not allowed."""
    payload = json.dumps({"form_filled": not _form_is_empty(state.get("form")), "message": state["message"]})
    intent = _ask_json(system, payload).get("intent", "question")
    if intent == "update" and _form_is_empty(state.get("form")):
        intent = "extract"
    return {"intent": intent if intent in ("extract", "update", "question") else "question"}


def pick_branch(state: State) -> str:
    return state["intent"]


# ---------- extract branch ----------
def extract_node(state: State) -> State:
    today = date.today().isoformat()
    system = f"""You are a QA assistant at an API pharmaceutical manufacturer. Extract deviation details
from the text. Return ONLY JSON with keys:
site (plant/site, or the reporting party/location if that is all that is given),
date_of_occurrence (YYYY-MM-DD; if no date is given use {today}),
title (max 120 chars, e.g. "Discolored Amoxicillin 500 mg Capsules"),
source (one of {SOURCES}; a complaint from a customer/pharmacy = "Customer Complaint"),
product (name and strength), batch_number,
description (2-3 sentences: what happened, where, when, how detected; use only stated facts),
date_stated (true/false: whether the text gave an occurrence date).
Use null for anything not stated. Never invent batch numbers."""
    text = (state.get("message") or "") + "\n" + (state.get("doc_text") or "")
    fields = _ask_json(system, text[:12000])
    assumed = fields.pop("date_stated", True) is False
    return {"fields": fields, "date_assumed": assumed}


def assess_node(state: State) -> State:
    system = f"""You are a GMP quality expert. Give an initial risk assessment for this deviation.
Return ONLY JSON with keys: impact (one of {IMPACTS}), severity (one of {SEVERITIES}),
reason (max 2 sentences: the likely impact and why this severity, citing the facts).
Critical = patient safety risk or major GMP/data integrity breach; High = likely product quality impact;
Medium = possible quality impact needing investigation; Low = no quality impact, contained."""
    a = _ask_json(system, json.dumps(state["fields"]))
    f = dict(state["fields"])
    f["impact"] = a.get("impact") if a.get("impact") in IMPACTS else None
    f["severity"] = a.get("severity") if a.get("severity") in SEVERITIES else None
    f["ai_reason"] = a.get("reason")
    return {"fields": f}


def normalize_node(state: State) -> State:
    f = dict(state["fields"])
    f["source"] = f.get("source") if f.get("source") in SOURCES else "Other"
    missing = [k for k in MANDATORY if not f.get(k)]
    reply = f"Parsed successfully. I've extracted the details for \"{f.get('title') or 'this deviation'}\" and filled the form."
    if f.get("severity"):
        reply += f" Initial assessment: {f['severity']} severity"
        reply += f", {f['impact']} impact." if f.get("impact") else "."
    if f.get("ai_reason"):
        reply += f" {f['ai_reason']}"
    if state.get("date_assumed"):
        reply += f" No date was given, so I used today's date ({f.get('date_of_occurrence')}). Please confirm."
    if missing:
        reply += " Still missing: " + ", ".join(m.replace("_", " ") for m in missing) + ". You can tell me here."
    return {"fields": f, "missing": missing, "reply": reply, "changed": []}


# ---------- update branch ----------
def update_node(state: State) -> State:
    system = f"""You update a deviation form from the user's correction. Current form is given.
Return ONLY JSON: {{"updates": {{field: new_value}}}} containing ONLY fields the user explicitly changed or added.
Allowed fields: {EDITABLE}. source must be one of {SOURCES}; impact one of {IMPACTS}; severity one of {SEVERITIES};
date_of_occurrence as YYYY-MM-DD. If the user mentions nothing to change, return {{"updates": {{}}}}."""
    payload = json.dumps({"form": state["form"], "message": state["message"]})
    raw = _ask_json(system, payload).get("updates", {}) or {}
    updates = {}
    for k, v in raw.items():
        if k not in EDITABLE or v in (None, ""):
            continue
        if (k == "source" and v not in SOURCES) or (k == "impact" and v not in IMPACTS) or (k == "severity" and v not in SEVERITIES):
            continue
        updates[k] = v
    if not updates:
        return {"fields": {}, "changed": [], "missing": [], "reply":
                "I couldn't tell which field to change. Try something like \"batch number is ABC123\"."}
    parts = [f'{k.replace("_", " ").title()} to "{v}"' for k, v in updates.items()]
    merged = {**state["form"], **updates}
    return {"fields": updates, "changed": list(updates), "reply": "Got it. I have updated " + " and ".join(parts) + " in the form.",
            "missing": [k for k in MANDATORY if not merged.get(k)]}


# ---------- question branch ----------
def answer_node(state: State) -> State:
    sys = ("You help QA staff with deviation management in API manufacturing (GMP, ICH Q7). "
           "Answer in short plain text. Never output JSON or code blocks. "
           "If the user wants to log an event, tell them to describe it (product, batch, what happened). "
           "Current form: " + json.dumps(state.get("form") or {}))
    out = text_llm().invoke([("system", sys), ("user", state["message"])]).content
    return {"reply": out.replace("```json", "").replace("```", "").strip(), "fields": {}, "changed": [], "missing": []}


g = StateGraph(State)
for name, fn in [("route", route_node), ("extract", extract_node), ("assess", assess_node),
                 ("normalize", normalize_node), ("update", update_node), ("answer", answer_node)]:
    g.add_node(name, fn)
g.set_entry_point("route")
g.add_conditional_edges("route", pick_branch, {"extract": "extract", "update": "update", "question": "answer"})
g.add_edge("extract", "assess")
g.add_edge("assess", "normalize")
g.add_edge("normalize", END)
g.add_edge("update", END)
g.add_edge("answer", END)
workflow = g.compile()


def run_assistant(message: str, doc_text: str, form: dict, force_extract: bool) -> dict:
    out = workflow.invoke({"message": message, "doc_text": doc_text, "form": form or {}, "force_extract": force_extract})
    return {"intent": out["intent"], "reply": out["reply"], "fields": out.get("fields", {}),
            "changed": out.get("changed", []), "missing": out.get("missing", [])}
