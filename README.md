# ⚙️ TaskCoin Backend – Micro-Task & Earning Platform API  

This is the **backend** of TaskCoin, a micro-task and earning platform that connects Buyers, Workers, and Admins. It provides secure APIs for authentication, task management, payments, and user role verification.  

---

## 🌐 Live API URL  
🔗 [https://your-backend-live-url.com](https://your-backend-live-url.com)  

---

## ✨ Features  

1. 🔐 **Firebase Authentication** with JWT verification middleware.  
2. 👨‍💻 **Role-based API Access** – `Admin`, `Buyer`, and `Worker` with separate routes.  
3. 📋 **Task Management** – Buyers can create, update, and delete tasks.  
4. 💼 **Worker Applications** – Workers can apply for posted tasks.  
5. 💰 **Stripe Payment Integration** – Secure transactions between Buyers and Workers.  
6. 🔎 **Admin APIs** – Admin can view all users, tasks, and transactions.  
7. ⚡ **Express Middleware** – Includes `verifyAdmin`, `verifyBuyer`, and `verifyWorker` for role checks.  
8. 🛡️ **Secured Secrets** – Environment variables stored in `.env`.  
9. 📊 **API Response Format** – Clean, structured JSON responses.  
10. 🚀 **Optimized Performance** – Built on Node.js & Express.js with MongoDB.  

---

## 🛠️ Tech Stack  

- **Runtime**: Node.js  
- **Framework**: Express.js  
- **Database**: MongoDB (Mongoose)  
- **Auth**: Firebase Admin + JWT  
- **Payment**: Stripe  
- **Other**: dotenv, cors, axios  

---

## 🔑 Authentication & Middleware  

### Role-based Verification APIs  
- `verifyAdmin` → Restricts access to Admin-only routes.  
- `verifyBuyer` → Restricts access to Buyer-only routes.  
- `verifyWorker` → Restricts access to Worker-only routes.  

Each middleware validates JWT + checks user role from DB.  

---

## 📌 Example API Endpoints  

### Auth & Users  
- `POST /jwt` → Issue JWT after Firebase login.  
- `GET /users` → Get all users (Admin only).  
- `PATCH /users/:id/role` → Update user role (Admin only).  

### Tasks  
- `POST /tasks` → Create new task (Buyer only).  
- `GET /tasks` → Get all tasks (Public).  
- `GET /tasks/:id` → Get single task by ID.  
- `PATCH /tasks/:id` → Update task (Buyer only).  
- `DELETE /tasks/:id` → Delete task (Buyer only).  

### Worker Applications  
- `POST /applications` → Worker applies to a task.  
- `GET /applications/:workerEmail` → Worker sees their applied tasks.  

### Payments  
- `POST /create-payment-intent` → Stripe integration for task payments.  
- `PATCH /payments/:id` → Update task/payment status.  

---

## ⚡ Installation & Setup  

```bash
# Clone backend repo
git clone https://github.com/your-username/taskcoin-server.git

# Navigate to project
cd taskcoin-server

# Install dependencies
npm install

# Create .env file and add:
PORT=5000
MONGO_URI=your_mongodb_connection_string
FIREBASE_SERVICE_KEY=your_base64_encoded_key
STRIPE_SECRET_KEY=your_stripe_secret_key
JWT_SECRET=your_jwt_secret

# Start server
npm run dev
