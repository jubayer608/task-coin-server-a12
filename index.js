const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');

// Load environment variables from .env file
dotenv.config();


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