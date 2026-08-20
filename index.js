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

// create a random parcel tracking id
const crypto = require("crypto");
const generateTrackingId = () => {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const randomCode = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${randomCode}`;
};

async function runStableAPIConnect() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();

    // create mongodb database
    const database = client.db("zap_shift_db");

    const parcelsCollection = database.collection("parcels");
    const paymentsCollection = database.collection("payments");

    // parcel api
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;

      //parcel createdTime and tracking id
      const trackingId = generateTrackingId();
      parcel.trackingId = trackingId;
      parcel.createdAt = new Date();

      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const { email } = req.query; //same as -> const email = req.query.email;
      const query = {};

      //localhost:3000/parcels?email=senderEmail
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
        mode: "payment",
        customer_email: paymentInfo.senderEmail,
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
          cost: paymentInfo.cost,
          trackingId: paymentInfo.trackingId,
        },
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

      // check is the parcel paid or not
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentsCollection.findOne(query);

      if (paymentExist) {
        return res.send({
          message: "payment already exist",
          transactionId: paymentExist.transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          amount: session.metadata.cost,
          currency: session.currency,

          customerEmail: session.customer_email,

          paymentStatus: session.payment_status,
          paidAt: new Date(),
          transactionId: session.payment_intent,
          trackingId: session.metadata.trackingId,
        };

        // console.log("payment-success payment", payment);

        if (session.payment_status === "paid") {
          const resultPayment = await paymentsCollection.insertOne(payment);

          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
            transactionId: session.payment_intent,
            trackingId: session.metadata.trackingId,
          });
        }
      }

      res.send({ success: false });
    });

    // payment related api
    app.get("/payments", async (req, res) => {
      const { email } = req.query;
      const query = {};

      if (email) {
        query.customerEmail = email;
      }

      const options = { sort: { paidAt: -1 } };

      const cursor = paymentsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/payments/:parcelId", async (req, res) => {
      const id = req.params.parcelId;
      const query = { _id: new ObjectId(id) };
      const result = await paymentsCollection.findOne(query);
      res.send(result);
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
