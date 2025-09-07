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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
     
     const db = client.db("taskCoinDB");
     const  usersCollection = db.collection("users");
     const tasksCollection = db.collection("tasks");
     // payment collection
     const paymentsCollection = db.collection("payments");
     const submissionsCollection = db.collection("submissions");
     // Backend: withdrawals collection
    const withdrawalsCollection = db.collection("withdrawals");
    const notificationsCollection=db.collection("notifications")
    // 1️⃣ Common function: Insert Notification
   const createNotification = async (notification) => {
   notification.time = new Date(); // always add time
   await notificationsCollection.insertOne(notification);
};

 // Create/Register User
app.post("/users", async (req, res) => {
  try {
    const { name, email, photoURL, role } = req.body;

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).send({ message: "Email already registered" });
    }

    // Set default coin based on role
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

    // Get user by email
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
    
    
app.post("/tasks", async (req, res) => {
  try {
    const {
      task_title,
      task_detail,
      required_workers,
      payable_amount,
      completion_date,
      submission_info,
      task_image_url,
      buyerId, // email
    } = req.body;

    const total_payable = Number(required_workers) * Number(payable_amount);

    // Fetch buyer by email
    const buyer = await usersCollection.findOne({ email: buyerId });
    if (!buyer) return res.status(404).send({ message: "Buyer not found" });

    if (total_payable > buyer.coin) {
      return res.status(400).send({ message: "Not enough coins" });
    }

    // Deduct coins
    await usersCollection.updateOne(
      { email: buyerId },
      { $inc: { coin: -total_payable } }
    );

    // Insert task
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

// Get all available tasks for workers
app.get("/tasks", async (req, res) => {
  try {
    const tasks = await tasksCollection
      .find({ required_workers: { $gt: 0 } })
      .sort({ completion_date: 1 }) // earliest deadline first
      .toArray();

    res.send(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).send({ message: "Failed to fetch tasks" });
  }
});

// get single task details
app.get("/tasks/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const task = await tasksCollection.findOne(query);
  res.send(task);
});

// worker submission API
app.post("/submissions", async (req, res) => {
  const submission = req.body;

  // forcefully set default fields
  submission.status = "pending";
  submission.current_date = new Date();

  const result = await submissionsCollection.insertOne(submission);

  
  await tasksCollection.updateOne(
    { _id: new ObjectId(submission.task_id) },
    { $inc: { required_workers: -1 } }
  );

  res.send(result);
});

// Get all submissions for a worker
app.get("/submissions", async (req, res) => {
  try {
    const workerEmail = req.query.workerEmail;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;

    if (!workerEmail) {
      return res.status(400).send({ message: "workerEmail is required" });
    }

    const query = { worker_email: workerEmail }; // ✅ snake_case

    const totalSubmissions = await submissionsCollection.countDocuments(query);

    const submissions = await submissionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.send({
      submissions,
      totalPages: Math.ceil(totalSubmissions / limit),
      currentPage: page,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error while fetching submissions" });
  }
});





// Get all tasks for a buyer
app.get("/tasks/buyer/:email", async (req, res) => {
  try {
    const buyerEmail = req.params.email;
    const tasks = await tasksCollection
      .find({ buyerId: buyerEmail })
      .sort({ completion_date: -1 }) // descending order by completion_date
      .toArray();
    res.status(200).send(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error while fetching tasks" });
  }
});

// Update a task (only Title, Detail, submission_info)
app.patch("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { task_title, task_detail, submission_info } = req.body;

    const { ObjectId } = require("mongodb");
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

// Delete task
app.delete("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { ObjectId } = require("mongodb");

    const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
    if (!task) return res.status(404).send({ message: "Task not found" });

    // Refill coins for uncompleted tasks
    const refillAmount = task.required_workers * task.payable_amount;
    await usersCollection.updateOne(
      { email: task.buyerId },
      { $inc: { coin: refillAmount } }
    );

    // Delete task
    const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ message: "Task deleted", result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error while deleting task" });
  }
});


// Get buyer stats
app.get("/buyer/stats/:email", async (req, res) => {
  try {
    const email = req.params.email;

    // Total tasks added by buyer
    const totalTasks = await tasksCollection.countDocuments({ buyerId: email });

    // Pending task workers
    const tasks = await tasksCollection.find({ buyerId: email }).toArray();
    const pendingWorkers = tasks.reduce((acc, task) => acc + task.required_workers, 0);

    // Total payment spent by buyer
    const payments = await paymentsCollection.find({ email }).toArray();
    const totalPaid = payments.reduce((acc, p) => acc + (p.amount || 0), 0);

    res.status(200).send({ totalTasks, pendingWorkers, totalPaid });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/buyer/submissions/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const submissions = await submissionsCollection
      .find({ Buyer_email: email, status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).send(submissions);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});

// Approve submission
app.patch("/buyer/submissions/approve/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const submission = await submissionsCollection.findOne({ _id: new ObjectId(id) });
    if (!submission) return res.status(404).send({ message: "Submission not found" });

    // Update worker coins
    await usersCollection.updateOne(
      { email: submission.worker_email },
      { $inc: { coin: submission.payable_amount } }
    );

    // Change submission status to approve
    const result = await submissionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "approve" } }
    );

    res.status(200).send(result);
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

    // Increase required_workers by 1
    await tasksCollection.updateOne(
      { _id: new ObjectId(submission.task_id) },
      { $inc: { required_workers: 1 } }
    );

    // Change submission status to rejected
    const result = await submissionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "rejected" } }
    );

    res.status(200).send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});

// Worker stats
app.get("/worker/stats/:email", async (req, res) => {
  const email = req.params.email;

  const totalSubmissions = await submissionsCollection.countDocuments({ worker_email: email });
  const pendingSubmissions = await submissionsCollection.countDocuments({ worker_email: email, status: "pending" });

  const approvedSubmissionsArr = await submissionsCollection.find({ worker_email: email, status: "approved" }).toArray();
  const approvedWithdrawalsArr = await withdrawalsCollection.find({ worker_email: email, status: "approved" }).toArray();

  const totalEarning = approvedSubmissionsArr.reduce((sum, s) => sum + Number(s.payable_amount || 0), 0) 
                     + approvedWithdrawalsArr.reduce((sum, w) => sum + Number(w.withdrawal_amount || 0), 0);

  res.send({ totalSubmissions, pendingSubmissions, totalEarning });
});

// Backend: Get worker's approved submissions (only buyer approved)
app.get("/worker/submissions/approved/:email", async (req, res) => {
  const email = req.params.email;

  try {
    
    const approvedSubmissions = await submissionsCollection
      .find({ worker_email: email, status: "approve" })
      .toArray();

    // Map to frontend-friendly format
    const formatted = approvedSubmissions.map(s => ({
      _id: s._id,
      task_title: s.task_title || s.task_name || "N/A",
      payable_amount: Number(s.payable_amount || 0),
      Buyer_email: s.Buyer_email || "Unknown",
      status: s.status,
      createdAt: s.createdAt || null,
    }));

    res.send(formatted);
  } catch (error) {
    console.error("Error fetching approved submissions:", error);
    res.status(500).send({ error: "Failed to fetch approved submissions" });
  }
});




// Dummy payment route (Stripe integration demo)
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, email } = req.body;

    // Stripe expects amount in cents
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

// Save Payment & Update Coins
app.post("/payment-success", async (req, res) => {
  try {
    const { email, coins, amount, transactionId } = req.body;

    if (!email || !coins || !amount || !transactionId) {
      return res.status(400).send({ message: "Invalid payment data" });
    }

    // Save payment record
    const paymentInfo = {
      email,
      coins,
      amount,
      transactionId,
      createdAt: new Date(),
    };

    await paymentsCollection.insertOne(paymentInfo);

    // Increase user coin balance
    await usersCollection.updateOne(
      { email },
      { $inc: { coin: coins } }
    );

    res.send({ success: true, message: "Payment recorded successfully" });
  } catch (error) {
    console.error("Error saving payment:", error);
    res.status(500).send({ success: false, message: "Payment save failed" });
  }
});


// Get Payment History by Email
app.get("/payments/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const payments = await paymentsCollection
      .find({ email })
      .sort({ createdAt: -1 }) // latest first
      .toArray();

    res.send(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).send({ success: false, message: "Failed to fetch payment history" });
  }
});

// Create a withdrawal request
app.post("/withdrawals", async (req, res) => {
  try {
    const {
      worker_email,
      worker_name,
      withdrawal_coin,
      withdrawal_amount,
      payment_system,
    } = req.body;

    if (!worker_email || !withdrawal_coin || !withdrawal_amount || !payment_system) {
      return res.status(400).send({ message: "All fields are required" });
    }

    // Check user coins
    const worker = await usersCollection.findOne({ email: worker_email });
    if (!worker) return res.status(404).send({ message: "Worker not found" });

    if (withdrawal_coin > worker.coin) {
      return res.status(400).send({ message: "Not enough coins" });
    }

    // Deduct coins immediately
    await usersCollection.updateOne(
      { email: worker_email },
      { $inc: { coin: -withdrawal_coin } }
    );

    const newWithdraw = {
      worker_email,
      worker_name,
      withdrawal_coin,
      withdrawal_amount,
      payment_system,
      withdraw_date: new Date(),
      status: "pending",
    };

    const result = await withdrawalsCollection.insertOne(newWithdraw);
    res.status(201).send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error while processing withdrawal" });
  }
});

// Get all withdrawals for a worker
app.get("/withdrawals", async (req, res) => {
  try {
    const workerEmail = req.query.workerEmail;
    if (!workerEmail) return res.status(400).send({ message: "workerEmail is required" });

    const withdrawals = await withdrawalsCollection
      .find({ worker_email: workerEmail })
      .sort({ withdraw_date: -1 })
      .toArray();

    res.status(200).send(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error while fetching withdrawals" });
  }
});

// ------------------- Manage Users APIs -------------------

// Get all users
app.get("/admin/users", async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.status(200).send(users);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error fetching users" });
  }
});

// Delete a user
app.delete("/admin/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ message: "User deleted", result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error deleting user" });
  }
});

// Update user role
app.patch("/admin/users/role/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    res.status(200).send({ message: "Role updated", result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error updating role" });
  }
});

// Manage Tasks APIs

// Get all tasks
app.get("/admin/tasks", async (req, res) => {
  try {
    const tasks = await tasksCollection.find().toArray();
    res.status(200).send(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error fetching tasks" });
  }
});

// Delete a task
app.delete("/admin/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
    if (!task) return res.status(404).send({ message: "Task not found" });

    // Optional: Refund coins to buyer if needed
    // const refundAmount = task.required_workers * task.payable_amount;
    // await usersCollection.updateOne(
    //   { email: task.buyerId },
    //   { $inc: { coin: refundAmount } }
    // );

    const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ message: "Task deleted", result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error deleting task" });
  }
});

// Get Top 6 Workers
app.get("/workers/top", async (req, res) => {
  try {
    const topWorkers = await usersCollection
      .find({ role: "worker" })
      .sort({ coins: -1 }) // coins descending
      .limit(6)
      .toArray();
    res.send(topWorkers);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Failed to fetch top workers" });
  }
});


// Get admin stats
app.get("/admin/stats", async (req, res) => {
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

// Get all pending withdrawals
app.get("/admin/withdrawals", async (req, res) => {
  try {
    const withdrawals = await withdrawalsCollection.find({ status: "pending" }).toArray();
    res.status(200).send(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error fetching withdrawals" });
  }
});

// Approve withdrawal
app.patch("/admin/withdrawals/approve/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const withdrawal = await withdrawalsCollection.findOne({ _id: new ObjectId(id) });
    if (!withdrawal) return res.status(404).send({ message: "Withdrawal not found" });

    // Update withdrawal status
    await withdrawalsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "approved" } }
    );

    // Deduct coins from user
    await usersCollection.updateOne(
      { email: withdrawal.user_email },
      { $inc: { coin: -withdrawal.withdrawal_coin } }
    );

    res.status(200).send({ message: "Withdrawal approved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error approving withdrawal" });
  }
});

// / 2️⃣ Worker → Buyer (when worker submits a task)
app.post("/submissions", async (req, res) => {
  try {
    const submission = req.body;
    const result = await submissionsCollection.insertOne(submission);

    // 🔔 Notify Buyer
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


// 3️⃣ Buyer → Worker (approve/reject submission)
app.patch("/submissions/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status, buyerName } = req.body;

    const submission = await submissionsCollection.findOne({ _id: new ObjectId(id) });

    if (!submission) return res.status(404).send({ message: "Submission not found" });

    const update = await submissionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (status === "approved") {
      // 🔔 Notify Worker (approved)
      await createNotification({
        message: `You have earned $${submission.payable_amount} from ${buyerName} for completing "${submission.task_title}".`,
        toEmail: submission.worker_email,
        actionRoute: "/dashboard/submissions",
      });
    } else if (status === "rejected") {
      // 🔔 Notify Worker (rejected)
      await createNotification({
        message: `Your submission for "${submission.task_title}" was rejected by ${buyerName}.`,
        toEmail: submission.worker_email,
        actionRoute: "/dashboard/submissions",
      });
    }

    res.send(update);
  } catch (error) {
    res.status(500).send({ message: "Failed to update submission", error });
  }
});


// 4️⃣ Admin → Worker (approve withdrawal)
app.patch("/withdrawals/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const withdrawal = await withdrawalsCollection.findOne({ _id: new ObjectId(id) });
    if (!withdrawal) return res.status(404).send({ message: "Withdrawal not found" });

    const update = await withdrawalsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (status === "approved") {
      // 🔔 Notify Worker
      await createNotification({
        message: `Your withdrawal request of $${withdrawal.withdrawal_amount} has been approved.`,
        toEmail: withdrawal.worker_email,
        actionRoute: "/dashboard/withdrawals",
      });
    }

    res.send(update);
  } catch (error) {
    res.status(500).send({ message: "Failed to update withdrawal", error });
  }
});


// 5️⃣ Get all notifications for a user
app.get("/notifications/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const notifications = await notificationsCollection
      .find({ toEmail: email })
      .sort({ time: -1 }) // latest first
      .toArray();
    res.send(notifications);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch notifications", error });
  }
});


// 6️⃣ Clear all notifications for a user
app.delete("/notifications/clear/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const result = await notificationsCollection.deleteMany({ toEmail: email });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to clear notifications", error });
  }
});


// Get all notifications for a user (sorted desc)
app.get("/notifications/:email", async (req, res) => {
  const { email } = req.params;
  const result = await notificationsCollection
    .find({ toEmail: email })
    .sort({ time: -1 })
    .toArray();
  res.send(result);
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
    res.send('task coin Server is running');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});