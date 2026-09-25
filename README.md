# AI-Powered Deviation Intake (API pharma)

Flow: document/text -> AI extraction -> Log Deviation form -> AI impact & severity -> user review -> save.
The left form is locked until the AI panel fills it (as the assignment requires); after that every field is editable.

## Run
Backend (Python 3.10+):
    cd backend
    python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
    pip install -r requirements.txt
    cp .env.example .env      # add GROQ_API_KEY (free at console.groq.com); set DATABASE_URL for PostgreSQL
    uvicorn main:app --reload --port 8000

Frontend (Node 18+):
    cd frontend
    npm install
    npm run dev               # http://localhost:5173

Try it with sample_deviation.txt (upload it or paste its text).

## Where to look (for your code walkthrough video)
1. frontend/src/App.jsx  Assistant()        -> user types/pastes in the chat, or drops a file
2. frontend/src/deviationSlice.js           -> sendToAssistant thunk POSTs message + file + current form to /api/assistant
3. backend/main.py       /api/assistant     -> file_to_text() (PDF/DOCX/XLSX/TXT), then run_assistant()
4. backend/graph.py                         -> LangGraph: route -> (extract -> assess -> normalize) | update | answer
5. Response {intent, reply, fields, changed, missing} -> reducer fills/updates the form; updated fields flash green
6. Save: saveDeviation thunk -> POST /api/deviations -> DB row, number DEV-YYYY-NNNN

## Design decisions to mention
- Two LLM calls (extract, assess) instead of one: each prompt is simple and testable, and the assessment sees clean fields.
- temperature 0 + JSON mode; the normalize node forces enum values so a bad model output can't break the form.
- The AI never invents missing data: null -> field flagged for the user.
- AI severity is a suggestion; the human reviews and can change it before save.
- Not built (say so honestly): OCR for image files, auth, edit/delete of saved deviations.
