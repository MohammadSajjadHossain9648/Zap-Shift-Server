const express = require("express");
var cors = require("cors");
const app = express();
require("dotenv").config();

const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

// mongodb
const { MongoClient, ServerApiVersion } = require("mongodb");

// Replace the placeholder with your Atlas connection string
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.bizjnmd.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function runStableAPIConnect() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();

    // Send a ping to confirm a successful connection
    const result = await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    return result;
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
runStableAPIConnect().catch(console.dir);

//router
app.get("/", (req, res) => {
  res.send("Welcome to Zap Shift");
});

app.listen(port, () => {
  console.log(`Zap Shift app listening on port ${port}`);
});
