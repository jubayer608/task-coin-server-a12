const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

// Load environment variables from .env file First
dotenv.config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.akopiuj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    const db = client.db("taskCoinDB");
    const usersCollection = db.collection("users");
    const tasksCollection = db.collection("tasks");
    const paymentsCollection = db.collection("payments");
    const submissionsCollection = db.collection("submissions");
    const withdrawalsCollection = db.collection("withdrawals");
    const notificationsCollection = db.collection("notifications");

    // =============================
    // 🔐 Firebase Middleware
    // =============================
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).send({ message: "Unauthorized" });
      const token = authHeader.split(" ")[1];
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
      } catch (err) {
        console.error(err);
        return res.status(401).send({ message: "Invalid token" });
      }
    };

    const adminVerify = async (req, res, next) => {
      try {
        const userEmail = req.user.email;
        const user = await usersCollection.findOne({ email: userEmail });
        if (user?.role !== "admin") {
          return res.status(403).send({ message: "Forbidden: Admins only" });
        }
        next();
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    };

    const buyerVerify = async (req, res, next) => {
      try {
        const userEmail = req.user.email;
        const user = await usersCollection.findOne({ email: userEmail });
        if (user?.role !== "buyer") {
          return res.status(403).send({ message: "Forbidden: Buyers only" });
        }
        next();
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    };

    const workerVerify = async (req, res, next) => {
      try {
        const userEmail = req.user.email;
        const user = await usersCollection.findOne({ email: userEmail });
        if (user?.role !== "worker") {
          return res.status(403).send({ message: "Forbidden: Workers only" });
        }
        next();
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    };
    
    // =============================
    // 🔔 Helper function for notifications
    // =============================
    const createNotification = async (notification) => {
      notification.time = new Date();
      await notificationsCollection.insertOne(notification);
    };

    // =============================
    // 👩‍💻 User APIs
    // =============================
    // Create/Register User (PUBLIC ROUTE)
    app.post("/users", async (req, res) => {
      try {
        const { name, email, photoURL, role } = req.body;
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(400).send({ message: "Email already registered" });
        }
        let defaultCoin = (role === "worker") ? 10 : 50;
        const newUser = { name, email, photoURL, role, coin: defaultCoin, createdAt: new Date() };
        const result = await usersCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get user by email (AUTHENTICATED)
    app.get("/users/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });
        res.status(200).send(user);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while fetching user" });
      }
    });

    // =============================
    // 💸 Buyer APIs
    // =============================

    // Add new tasks (BUYER ONLY)
    app.post("/tasks", verifyToken, buyerVerify, async (req, res) => {
      try {
        const { task_title, task_detail, required_workers, payable_amount, completion_date, submission_info, task_image_url, buyerId } = req.body;
        const total_payable = Number(required_workers) * Number(payable_amount);
        const buyer = await usersCollection.findOne({ email: buyerId });
        if (!buyer) return res.status(404).send({ message: "Buyer not found" });
        if (total_payable > buyer.coin) {
          return res.status(400).send({ message: "Not enough coins" });
        }
        await usersCollection.updateOne({ email: buyerId }, { $inc: { coin: -total_payable } });
        const newTask = { task_title, task_detail, required_workers: Number(required_workers), payable_amount: Number(payable_amount), total_payable, completion_date, submission_info, task_image_url, buyerId, createdAt: new Date() };
        const result = await tasksCollection.insertOne(newTask);
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while adding task" });
      }
    });

    // Get all tasks for a buyer (BUYER ONLY)
    app.get("/tasks/buyer/:email", verifyToken, buyerVerify, async (req, res) => {
      try {
        const buyerEmail = req.params.email;
        const tasks = await tasksCollection.find({ buyerId: buyerEmail }).sort({ completion_date: -1 }).toArray();
        res.status(200).send(tasks);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while fetching tasks" });
      }
    });
    
    // Update a task (BUYER ONLY)
    app.patch("/tasks/:id", verifyToken, buyerVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const { task_title, task_detail, submission_info } = req.body;
        const result = await tasksCollection.updateOne({ _id: new ObjectId(id) }, { $set: { task_title, task_detail, submission_info } });
        res.status(200).send({ message: "Task updated", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while updating task" });
      }
    });
    
    // Delete task (BUYER ONLY)
    app.delete("/tasks/:id", verifyToken, buyerVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) return res.status(404).send({ message: "Task not found" });
        const refillAmount = task.required_workers * task.payable_amount;
        await usersCollection.updateOne({ email: task.buyerId }, { $inc: { coin: refillAmount } });
        const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).send({ message: "Task deleted", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while deleting task" });
      }
    });

    // Get buyer dashboard stats (BUYER ONLY)
    app.get("/buyer/stats/:email", verifyToken, buyerVerify, async (req, res) => {
      try {
        const email = req.params.email;
        const totalTasks = await tasksCollection.countDocuments({ buyerId: email });
        const tasks = await tasksCollection.find({ buyerId: email }).toArray();
        const pendingWorkers = tasks.reduce((acc, task) => acc + task.required_workers, 0);
        const payments = await paymentsCollection.find({ email }).toArray();
        const totalPaid = payments.reduce((acc, p) => acc + (p.amount || 0), 0);
        res.status(200).send({ totalTasks, pendingWorkers, totalPaid });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get submissions for review (BUYER ONLY)
    app.get("/buyer/submissions/:email", verifyToken, buyerVerify, async (req, res) => {
      try {
        const email = req.params.email;
        const submissions = await submissionsCollection.find({ Buyer_email: email, status: "pending" }).sort({ createdAt: -1 }).toArray();
        res.status(200).send(submissions);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });
    
    // Approve/Reject a submission (BUYER ONLY)
    app.patch("/buyer/submissions/:id", verifyToken, buyerVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const { status, buyerName } = req.body;
        const submission = await submissionsCollection.findOne({ _id: new ObjectId(id) });
        if (!submission) return res.status(404).send({ message: "Submission not found" });
        await submissionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });
        if (status === "approve") {
          await usersCollection.updateOne({ email: submission.worker_email }, { $inc: { coin: submission.payable_amount } });
          await createNotification({
            message: `You earned $${submission.payable_amount} from ${buyerName} for "${submission.task_title}".`,
            toEmail: submission.worker_email,
            actionRoute: "/dashboard/submissions",
          });
        } else if (status === "rejected") {
          await tasksCollection.updateOne({ _id: new ObjectId(submission.task_id) }, { $inc: { required_workers: 1 } });
          await createNotification({
            message: `Your submission for "${submission.task_title}" was rejected by ${buyerName}.`,
            toEmail: submission.worker_email,
            actionRoute: "/dashboard/submissions",
          });
        }
        res.send({ success: true, message: `Submission ${status}` });
      } catch (error) {
        res.status(500).send({ message: "Failed to update submission", error });
      }
    });
    
    // Create payment intent (AUTHENTICATED)
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      try {
        const { amount, email } = req.body;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "usd",
          metadata: { integration_check: "accept_a_payment", email },
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Payment failed" });
      }
    });
    
    // Save Payment & Update Coins (AUTHENTICATED)
    app.post("/payment-success", verifyToken, async (req, res) => {
      try {
        const { email, coins, amount, transactionId } = req.body;
        if (!email || !coins || !amount || !transactionId) {
          return res.status(400).send({ message: "Invalid payment data" });
        }
        const paymentInfo = { email, coins, amount, transactionId, createdAt: new Date() };
        await paymentsCollection.insertOne(paymentInfo);
        await usersCollection.updateOne({ email }, { $inc: { coin: coins } });
        res.send({ success: true, message: "Payment recorded successfully" });
      } catch (error) {
        console.error("Error saving payment:", error);
        res.status(500).send({ success: false, message: "Payment save failed" });
      }
    });

    // Get Payment History by Email (BUYER ONLY)
    app.get("/payments/:email", verifyToken, buyerVerify, async (req, res) => {
      try {
        const email = req.params.email;
        const payments = await paymentsCollection.find({ email }).sort({ createdAt: -1 }).toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ success: false, message: "Failed to fetch payment history" });
      }
    });

    // =============================
    // 💼 Worker APIs
    // =============================

    // Get all available tasks for workers (WORKER ONLY)
    app.get("/tasks", verifyToken, workerVerify, async (req, res) => {
      try {
        const tasks = await tasksCollection.find({ required_workers: { $gt: 0 } }).sort({ completion_date: 1 }).toArray();
        res.send(tasks);
      } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).send({ message: "Failed to fetch tasks" });
      }
    });

    // Get single task details (AUTHENTICATED)
    app.get("/tasks/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const task = await tasksCollection.findOne(query);
      res.send(task);
    });

    // Submit a task (WORKER ONLY)
    app.post("/submissions", verifyToken, workerVerify, async (req, res) => {
      try {
        const submission = req.body;
        submission.status = "pending";
        submission.current_date = new Date();
        const result = await submissionsCollection.insertOne(submission);
        await tasksCollection.updateOne({ _id: new ObjectId(submission.task_id) }, { $inc: { required_workers: -1 } });
        await createNotification({
          message: `${submission.worker_name} submitted your task "${submission.task_title}".`,
          toEmail: submission.Buyer_email,
          actionRoute: "/dashboard/my-tasks",
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add submission", error });
      }
    });

    // Get all submissions for a worker (WORKER ONLY)
    app.get("/submissions", verifyToken, workerVerify, async (req, res) => {
      try {
        const workerEmail = req.query.workerEmail;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        if (!workerEmail) return res.status(400).send({ message: "workerEmail is required" });
        const query = { worker_email: workerEmail };
        const totalSubmissions = await submissionsCollection.countDocuments(query);
        const submissions = await submissionsCollection.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray();
        res.send({ submissions, totalPages: Math.ceil(totalSubmissions / limit), currentPage: page });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while fetching submissions" });
      }
    });
    
    // Get worker dashboard stats (WORKER ONLY)
    app.get("/worker/stats/:email", verifyToken, workerVerify, async (req, res) => {
      const email = req.params.email;
      const totalSubmissions = await submissionsCollection.countDocuments({ worker_email: email });
      const pendingSubmissions = await submissionsCollection.countDocuments({ worker_email: email, status: "pending" });
      const approvedSubmissionsArr = await submissionsCollection.find({ worker_email: email, status: "approve" }).toArray();
      const approvedWithdrawalsArr = await withdrawalsCollection.find({ worker_email: email, status: "approved" }).toArray();
      const totalEarning = approvedSubmissionsArr.reduce((sum, s) => sum + Number(s.payable_amount || 0), 0) + approvedWithdrawalsArr.reduce((sum, w) => sum + Number(w.withdrawal_amount || 0), 0);
      res.send({ totalSubmissions, pendingSubmissions, totalEarning });
    });
    
    // Get worker's approved submissions (WORKER ONLY)
    app.get("/worker/submissions/approved/:email", verifyToken, workerVerify, async (req, res) => {
      const email = req.params.email;
      try {
        const approvedSubmissions = await submissionsCollection.find({ worker_email: email, status: "approve" }).toArray();
        const formatted = approvedSubmissions.map(s => ({ _id: s._id, task_title: s.task_title || "N/A", payable_amount: Number(s.payable_amount || 0), Buyer_email: s.Buyer_email || "Unknown", status: s.status, createdAt: s.createdAt || null, }));
        res.send(formatted);
      } catch (error) {
        console.error("Error fetching approved submissions:", error);
        res.status(500).send({ error: "Failed to fetch approved submissions" });
      }
    });
    
    // Create a withdrawal request (WORKER ONLY)
    app.post("/withdrawals", verifyToken, workerVerify, async (req, res) => {
      try {
        const { worker_email, worker_name, withdrawal_coin, withdrawal_amount, payment_system } = req.body;
        if (!worker_email || !withdrawal_coin || !withdrawal_amount || !payment_system) return res.status(400).send({ message: "All fields are required" });
        const worker = await usersCollection.findOne({ email: worker_email });
        if (!worker) return res.status(404).send({ message: "Worker not found" });
        if (withdrawal_coin > worker.coin) return res.status(400).send({ message: "Not enough coins" });
        await usersCollection.updateOne({ email: worker_email }, { $inc: { coin: -withdrawal_coin } });
        const newWithdraw = { worker_email, worker_name, withdrawal_coin, withdrawal_amount, payment_system, withdraw_date: new Date(), status: "pending" };
        const result = await withdrawalsCollection.insertOne(newWithdraw);
        const admins = await usersCollection.find({ role: "admin" }).toArray();
        const notifications = admins.map(admin => ({ toEmail: admin.email, message: `${worker_name} requested $${withdrawal_amount} withdrawal via ${payment_system}.`, actionRoute: "/dashboard/withdraw-requests", time: new Date() }));
        if (notifications.length > 0) {
          await notificationsCollection.insertMany(notifications);
        }
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while processing withdrawal" });
      }
    });
    
    // Get all withdrawals for a worker (WORKER ONLY)
    app.get("/withdrawals", verifyToken, workerVerify, async (req, res) => {
      try {
        const workerEmail = req.query.workerEmail;
        if (!workerEmail) return res.status(400).send({ message: "workerEmail is required" });
        const withdrawals = await withdrawalsCollection.find({ worker_email: workerEmail }).sort({ withdraw_date: -1 }).toArray();
        res.status(200).send(withdrawals);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while fetching withdrawals" });
      }
    });


    // =============================
    // 👑 Admin APIs
    // =============================

    // Get all users (ADMIN ONLY)
    app.get("/admin/users", verifyToken, adminVerify, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).send(users);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error fetching users" });
      }
    });

    // Delete a user (ADMIN ONLY)
    app.delete("/admin/users/:id", verifyToken, adminVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).send({ message: "User deleted", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error deleting user" });
      }
    });

    // Update user role (ADMIN ONLY)
    app.patch("/admin/users/role/:id", verifyToken, adminVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;
        const result = await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role } });
        res.status(200).send({ message: "Role updated", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error updating role" });
      }
    });
    
    // Get all tasks (ADMIN ONLY)
    app.get("/admin/tasks", verifyToken, adminVerify, async (req, res) => {
      try {
        const tasks = await tasksCollection.find().toArray();
        res.status(200).send(tasks);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error fetching tasks" });
      }
    });
    
    // Delete a task (ADMIN ONLY)
    app.delete("/admin/tasks/:id", verifyToken, adminVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) return res.status(404).send({ message: "Task not found" });
        const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).send({ message: "Task deleted", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error deleting task" });
      }
    });

    // Get admin stats (ADMIN ONLY)
    app.get("/admin/stats", verifyToken, adminVerify, async (req, res) => {
      try {
        const totalWorkers = await usersCollection.countDocuments({ role: "worker" });
        const totalBuyers = await usersCollection.countDocuments({ role: "buyer" });
        const users = await usersCollection.find().toArray();
        const totalCoins = users.reduce((sum, u) => sum + (u.coin || 0), 0);
        const payments = await paymentsCollection.find().toArray();
        const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        res.status(200).send({ totalWorkers, totalBuyers, totalCoins, totalPayments });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error fetching stats" });
      }
    });

    // Get all pending withdrawals (ADMIN ONLY)
    app.get("/admin/withdrawals", verifyToken, adminVerify, async (req, res) => {
      try {
        const withdrawals = await withdrawalsCollection.find({ status: "pending" }).toArray();
        res.status(200).send(withdrawals);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error fetching withdrawals" });
      }
    });
    
    // Approve a withdrawal (ADMIN ONLY)
    app.patch("/admin/withdrawals/approve/:id", verifyToken, adminVerify, async (req, res) => {
      try {
        const { id } = req.params;
        const withdrawal = await withdrawalsCollection.findOne({ _id: new ObjectId(id) });
        if (!withdrawal) return res.status(404).send({ message: "Withdrawal not found" });
        await withdrawalsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });
        await createNotification({
          message: `Your withdrawal request of $${withdrawal.withdrawal_amount} has been approved.`,
          toEmail: withdrawal.worker_email,
          actionRoute: "/dashboard/withdrawals",
        });
        res.status(200).send({ message: "Withdrawal approved successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error approving withdrawal" });
      }
    });
    
    // =============================
    // 🔔 Notification APIs
    // =============================

    // Get notifications by email (AUTHENTICATED)
    app.get("/notifications/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        const result = await notificationsCollection.find({ toEmail: email }).sort({ time: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch notifications", error });
      }
    });

    // Clear notifications by email (AUTHENTICATED)
    app.delete("/notifications/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        const result = await notificationsCollection.deleteMany({ toEmail: email });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to clear notifications", error });
      }
    });

    // =============================
    // 🌐 Public APIs
    // =============================
    
    // Get Top 6 Workers (PUBLIC ROUTE)
    app.get("/workers/top", async (req, res) => {
      try {
        const topWorkers = await usersCollection.find({ role: "worker" }).sort({ coin: -1 }).limit(6).toArray();
        res.send(topWorkers);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch top workers" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Sample route
app.get('/', (req, res) => {
  res.send('TaskCoin Server is running');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
