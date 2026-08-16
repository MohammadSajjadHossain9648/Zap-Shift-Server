const express = require("express");
var cors = require("cors");
const app = express();
require("dotenv").config();

const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

// mongodb
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

//stripe payment method
const stripe = require("stripe")(process.env.STRIPE_SECRET);

async function runStableAPIConnect() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();

    // create mongodb database
    const database = client.db("zap_shift_db");

    const parcelsCollection = database.collection("parcels");

    // parcel api
    app.get("/parcels", async (req, res) => {
      const query = {};

      //localhost:3000/parcels?email=senderEmail
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      // sort the parcel table
      const options = { sort: { createdAt: -1 } };

      const cursor = parcelsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:parcelId", async (req, res) => {
      const id = req.params.parcelId;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;

      //parcel createdTime
      parcel.createdAt = new Date();

      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:parcelId", async (req, res) => {
      const id = req.params.parcelId;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    // stripe payment api
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      // console.log("payment info in payment-checkout-session", paymentInfo);

      // Original cost is BDT
      const bdtCost = parseFloat(paymentInfo.cost);
      // Convert BDT → USD
      const usdCost = bdtCost / 127.5856;
      // Stripe uses cents
      const stripeAmount = Math.round(usdCost * 100);

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: stripeAmount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        mode: "payment",
        success_url: `${process.env.STRIPE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.STRIPE_DOMAIN}/dashboard/payment-cancelled?parcelId=${paymentInfo.parcelId}`,

        // Provide a name (for example, hosted_web_0001) to label this Checkout integration and measure its conversion independently
        // integration_identifier: "{{INTEGRATION_ID}}",
      });

      // console.log("backend session", session);
      res.send({ url: session.url });
    });

    //payment success page api
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log("session retrieve", session);

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
          },
        };
        const result = await parcelsCollection.updateOne(query, update);
        res.send(result);
      }

      res.send({ success: false });
    });

    // extra
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
