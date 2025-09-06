const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Load environment variables from .env file
dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.akopiuj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
     
    const db = client.db("taskCoinDB");
    const usersCollection = db.collection("users");
    const tasksCollection = db.collection("tasks");
    const paymentsCollection = db.collection("payments");
    const submissionsCollection = db.collection("submissions");
    const withdrawalsCollection = db.collection("withdrawals");
    const notificationsCollection = db.collection("notifications"); 

    // Notification helper function
    async function createNotification(message, toEmail, actionRoute = "/") {
      try {
        await notificationsCollection.insertOne({
          message,
          toEmail,
          actionRoute,
          time: new Date(),
          read: false,
        });
      } catch (err) {
        console.error("Failed to create notification:", err);
      }
    }

    // ------------------- User APIs -------------------
    app.post("/users", async (req, res) => {
      try {
        const { name, email, photoURL, role } = req.body;
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) return res.status(400).send({ message: "Email already registered" });

        let defaultCoin = 0;
        if (role === "worker") defaultCoin = 10;
        else if (role === "buyer") defaultCoin = 50;

        const newUser = {
          name,
          email,
          photoURL,
          role: role || "worker",
          coin: defaultCoin,
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/users/:email", async (req, res) => {
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

    // ------------------- Task APIs -------------------
    app.post("/tasks", async (req, res) => {
      try {
        const { task_title, task_detail, required_workers, payable_amount, completion_date, submission_info, task_image_url, buyerId } = req.body;
        const total_payable = Number(required_workers) * Number(payable_amount);

        const buyer = await usersCollection.findOne({ email: buyerId });
        if (!buyer) return res.status(404).send({ message: "Buyer not found" });
        if (total_payable > buyer.coin) return res.status(400).send({ message: "Not enough coins" });

        await usersCollection.updateOne({ email: buyerId }, { $inc: { coin: -total_payable } });

        const newTask = {
          task_title,
          task_detail,
          required_workers: Number(required_workers),
          payable_amount: Number(payable_amount),
          total_payable,
          completion_date,
          submission_info,
          task_image_url,
          buyerId,
          createdAt: new Date(),
        };

        const result = await tasksCollection.insertOne(newTask);
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while adding task" });
      }
    });

    app.get("/tasks", async (req, res) => {
      try {
        const tasks = await tasksCollection.find({ required_workers: { $gt: 0 } }).sort({ completion_date: 1 }).toArray();
        res.send(tasks);
      } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).send({ message: "Failed to fetch tasks" });
      }
    });

    app.get("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
      res.send(task);
    });

    app.patch("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { task_title, task_detail, submission_info } = req.body;
        const result = await tasksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { task_title, task_detail, submission_info } }
        );
        res.status(200).send({ message: "Task updated", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while updating task" });
      }
    });

    app.delete("/tasks/:id", async (req, res) => {
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

    // ------------------- Submission APIs -------------------
    app.post("/submissions", async (req, res) => {
      const submission = req.body;
      submission.status = "pending";
      submission.current_date = new Date();
      const result = await submissionsCollection.insertOne(submission);

      await tasksCollection.updateOne({ _id: new ObjectId(submission.task_id) }, { $inc: { required_workers: -1 } });

      // ✅ Notification to buyer for new submission
      const task = await tasksCollection.findOne({ _id: new ObjectId(submission.task_id) });
      await createNotification(
        `New submission for "${task.task_title}" by ${submission.worker_name}`,
        task.buyerId,
        "/dashboard/buyer-submissions"
      );

      res.send(result);
    });

    app.get("/submissions", async (req, res) => {
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

    // Approve submission
    app.patch("/buyer/submissions/approve/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const submission = await submissionsCollection.findOne({ _id: new ObjectId(id) });
        if (!submission) return res.status(404).send({ message: "Submission not found" });

        await usersCollection.updateOne({ email: submission.worker_email }, { $inc: { coin: submission.payable_amount } });
        await submissionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });

        // ✅ Notification to worker
        await createNotification(
          `Your submission for "${submission.task_title}" has been approved. You earned ${submission.payable_amount} coins.`,
          submission.worker_email,
          "/dashboard/worker-home"
        );

        res.status(200).send({ message: "Submission approved and notification sent" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Reject submission
    app.patch("/buyer/submissions/reject/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const submission = await submissionsCollection.findOne({ _id: new ObjectId(id) });
        if (!submission) return res.status(404).send({ message: "Submission not found" });

        await tasksCollection.updateOne({ _id: new ObjectId(submission.task_id) }, { $inc: { required_workers: 1 } });
        await submissionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "rejected" } });

        // ✅ Notification to worker
        await createNotification(
          `Your submission for "${submission.task_title}" has been rejected.`,
          submission.worker_email,
          "/dashboard/worker-home"
        );

        res.status(200).send({ message: "Submission rejected and notification sent" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ------------------- Withdrawal APIs -------------------
    app.post("/withdrawals", async (req, res) => {
      try {
        const { worker_email, worker_name, withdrawal_coin, withdrawal_amount, payment_system } = req.body;
        if (!worker_email || !withdrawal_coin || !withdrawal_amount || !payment_system) return res.status(400).send({ message: "All fields are required" });

        const worker = await usersCollection.findOne({ email: worker_email });
        if (!worker) return res.status(404).send({ message: "Worker not found" });
        if (withdrawal_coin > worker.coin) return res.status(400).send({ message: "Not enough coins" });

        await usersCollection.updateOne({ email: worker_email }, { $inc: { coin: -withdrawal_coin } });

        const newWithdraw = { worker_email, worker_name, withdrawal_coin, withdrawal_amount, payment_system, withdraw_date: new Date(), status: "pending" };
        const result = await withdrawalsCollection.insertOne(newWithdraw);

        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error while processing withdrawal" });
      }
    });

    app.patch("/withdrawals/approve/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const withdrawal = await withdrawalsCollection.findOne({ _id: new ObjectId(id) });
        if (!withdrawal) return res.status(404).send({ message: "Withdrawal not found" });

        await withdrawalsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "approved" } });

        // ✅ Notification to worker
        await createNotification(
          `Your withdrawal request of ${withdrawal.withdrawal_amount} has been approved.`,
          withdrawal.worker_email,
          "/dashboard/withdrawals"
        );

        res.send({ message: "Withdrawal approved and notification sent" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ------------------- Get Notifications -------------------
    app.get("/notifications", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).send({ message: "email is required" });

        const notifications = await notificationsCollection.find({ toEmail: email }).sort({ time: -1 }).toArray();
        res.status(200).send(notifications);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error fetching notifications" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('task coin Server is running');
});

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});
