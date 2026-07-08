# SEMCO Smart RFQ AI Agent – Enterprise Procurement Automation Platform

A modern SaaS-grade procurement platform for **SEMCO Process Systems & Vacuum Pvt. Ltd.** to automate the Request for Quotation (RFQ) lifecycle. The system automates vendor databases, draft creations, isolated link distribution, quote collections, L1 rankings calculations, comparative matrices, and natural language AI assistance.

---

## 🚀 Getting Started

The platform is designed to operate in **Dual-Mode** to run out-of-the-box on your machine without configuration, while allowing full backend integration once a Node.js runtime is configured.

### Mode 1: Offline Browser Simulation (No Setup Required)
You can open and run the entire application immediately in your browser:
1. Double-click the `index.html` file, or open it in Google Chrome.
2. The application will detect that the Express server is offline and automatically launch in **Simulated Local Mode**.
3. All data (vendors, RFQs, quotations, logs) will persist inside your browser's `localStorage`. You can create RFQs, simulate vendor submissions, check comparative reports, and query the AI Copilot offline.

---

### Mode 2: Live Backend Server (with SendGrid & OpenAI)
To enable actual email dispatches via SendGrid and real AI reasoning:

1. **Install Node.js & Dependencies:**
   Ensure Node.js is installed, navigate to the folder, and run:
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Copy `.env.example` to a new file named `.env`:
   ```bash
   copy .env.example .env
   ```
   Open the `.env` file and insert your credentials:
   - `SENDGRID_API_KEY`: Your SendGrid API Key (must start with `SG.`).
   - `SENDGRID_FROM_EMAIL`: Your verified sender address from the SendGrid panel.
   - `OPENAI_API_KEY`: Your OpenAI API key for live Copilot reasoning.

3. **Start the Express Server:**
   Run the following command to start the backend:
   ```bash
   npm start
   ```
   The backend database will be initialized at `data/semco-rfq.db` using SQLite.

4. **Launch the Application:**
   Open Chrome and navigate to:
   [http://localhost:3000](http://localhost:3000)
   
   The page will automatically connect to the Express server, showing a green **"Live Express Server"** status in the header. All emails will now send via live SendGrid SMTP/API routes!

---

## 🛠️ Module Architecture

- **Module 1 – Vendor Master Database:** Search, filter, add/edit/delete vendors. Form validation for GST and PAN formats. Excel imports/exports simulation.
- **Module 2 – RFQ Creation:** Step-by-step form to create RFQ drafts with auto-sequenced numbering (`RFQ-2026-001`). Add item tables with MOC, quantity, unit, and excel importing.
- **Module 3 – One-Click RFQ Distribution:** Select vendors and distribute. Generates unique vendor access tokens and isolated links (`?token=XYZ`), and sends HTML emails via SendGrid.
- **Module 4 – Isolated Vendor Portal:** Secure, individual vendor portal screen where vendors can submit rates, lead times, payment terms, and remarks. Submission locks upon final submit.
- **Module 5 & 6 – Tracking & Follow-up Agent:** Real-time completion progress tracking, and AI-scheduled email reminders on Days 2, 4, and 6.
- **Module 7 & 8 – Comparative & L1 Engines:** Color-coded comparative matrices (Green = Lowest Price, Red = High Price). Computes L1/L2/L3 vendor rankings and savings winner cards.
- **Module 9 – AI Intelligence Reports:** Structured commercial, risk, and action plan summaries.
- **Module 10 – Analytics Dashboard:** KPI metrics and interactive Chart.js graphs mapping price trends, RFQ statuses, and savings.
- **Module 11 – Report Exporting:** Direct PDF printing and CSV data downloading.
- **Module 12 & 13 – Audit Trail & Security:** Immutable logging of user login, RFQ creation, vendor opens, and role settings (Admin/Executive/Vendor restrictions).
- **Module 15 – AI Copilot Chat:** NLP chat box supporting natural language questions like *"Who responded fastest?"* or *"Show vendors 10% below average rate"*.

---

## 📂 Active Workspace Recommendation

For best development alignment, we recommend setting this project directory as your active workspace in VS Code:
- Open VS Code.
- Go to **File > Open Folder...** and select this project's root folder.
