import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

const EMPTY_FORM = {
  site: "", date_of_occurrence: "", title: "", source: "", product: "",
  batch_number: "", description: "", impact: "", severity: "", ai_reason: "",
};

async function api(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || "Something went wrong. Try again.");
  return body;
}

// One thunk for the whole AI panel. Typed messages, pasted text and files all go to /api/assistant.
// The backend (LangGraph) decides whether to extract a new deviation, update fields, or answer a question.
export const sendToAssistant = createAsyncThunk("deviation/assistant", async ({ message = "", file = null, forceExtract = false }, { getState, rejectWithValue }) => {
  try {
    const { form } = getState().deviation;
    const fd = new FormData();
    fd.append("message", message);
    fd.append("form", JSON.stringify(form));
    fd.append("force_extract", forceExtract);
    if (file) fd.append("file", file);
    return await api("/api/assistant", { method: "POST", body: fd });
  } catch (e) { return rejectWithValue(e.message); }
});

export const saveDeviation = createAsyncThunk("deviation/save", async (_, { getState, rejectWithValue }) => {
  try {
    const { form } = getState().deviation;
    return await api("/api/deviations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
  } catch (e) { return rejectWithValue(e.message); }
});

export const loadOptions = createAsyncThunk("deviation/options", () => api("/api/options"));
export const loadSaved = createAsyncThunk("deviation/list", () => api("/api/deviations"));

const initialState = {
  form: EMPTY_FORM,
  unlocked: false,       // form fields are editable only after AI has filled them
  missing: [],
  status: "idle",        // idle | extracting | ready | saving | saved
  error: null,
  options: { sources: [], impacts: [], severities: [] },
  messages: [{ role: "ai", text: "Upload a deviation report, lab result, or paste text above. I'll extract the details and fill the form for you." }],
  chatBusy: false,
  saved: [],
  lastSaved: null,
  extracting: false,
  changed: [],           // fields the AI just updated (highlighted green)
};

const slice = createSlice({
  name: "deviation",
  initialState,
  reducers: {
    updateField: (s, { payload: { name, value } }) => { s.form[name] = value; s.changed = s.changed.filter((k) => k !== name); },
    resetForm: (s) => ({ ...initialState, options: s.options, saved: s.saved, messages: initialState.messages }),
    dismissError: (s) => { s.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(sendToAssistant.pending, (s, { meta }) => {
       const { message, file, forceExtract } = meta.arg;
       s.chatBusy = true; s.error = null; s.changed = [];
       s.extracting = !!(file || forceExtract);
       if (file) s.messages.push({ role: "user", file: file.name });
       if (message) s.messages.push({ role: "user", text: message });
     })
     .addCase(sendToAssistant.fulfilled, (s, { payload }) => {
       s.chatBusy = false; s.extracting = false;
       if (payload.intent === "extract") {
         s.form = { ...EMPTY_FORM, ...Object.fromEntries(Object.entries(payload.fields).map(([k, v]) => [k, v ?? ""])) };
         s.unlocked = true; s.status = "ready"; s.missing = payload.missing;
       } else if (payload.intent === "update" && payload.changed.length) {
         s.form = { ...s.form, ...payload.fields };
         s.changed = payload.changed; s.missing = payload.missing;
       }
       s.messages.push({ role: "ai", text: payload.reply });
     })
     .addCase(sendToAssistant.rejected, (s, { payload }) => {
       s.chatBusy = false; s.extracting = false;
       s.messages.push({ role: "ai", text: payload || "Couldn't reach the assistant." });
     })
     .addCase(saveDeviation.pending, (s) => { s.status = "saving"; s.error = null; })
     .addCase(saveDeviation.fulfilled, (s, { payload }) => {
       s.status = "saved"; s.lastSaved = payload; s.saved.unshift(payload);
       s.form = EMPTY_FORM; s.unlocked = false; s.missing = []; s.changed = [];
     })
     .addCase(saveDeviation.rejected, (s, { payload }) => { s.status = "ready"; s.error = payload; })
     .addCase(loadOptions.fulfilled, (s, { payload }) => { s.options = payload; })
     .addCase(loadSaved.fulfilled, (s, { payload }) => { s.saved = payload; });
  },
});

export const { updateField, resetForm, dismissError } = slice.actions;
export default slice.reducer;
