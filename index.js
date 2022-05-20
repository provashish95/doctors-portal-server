const express = require('express')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000



//middleware 
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.p9ooz.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const usersCollection = client.db('doctors_portal').collection('users');
        const doctorsCollection = client.db('doctors_portal').collection('doctors');
        const paymentsCollection = client.db('doctors_portal').collection('payments');

        //verify admin 
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            } else {
                return res.status(403).send({ message: 'Forbidden access' })
            }
        }

        //payment post api 
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });

        //update data for payment by id 
        app.patch('/booking/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentsCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updateDoc);
        });


        //get services with only one name field by project
        app.get('/service', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services)
        });

        /**
         * app.get('/booking) get all booking in this collection or get more than one or by filter
         * app.get('/booking/:id) get a specific booking 
         * app.post('/booking) add a new booking
         * app.patch('/booking/:id)  update a specific booking
         * app.put('/booking/:id)   (upsert==> update/insert)  if exist than update if not exist than create /add
         * app.delete('/booking/:id)  delete a specific booking
         *   
        */
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatmentName: booking.treatmentName, date: booking.date, patientName: booking.patientName }
            const exists = await bookingCollection.findOne(query);

            if (exists) {
                return res.send({ success: false, booking: exists });
            } else {
                const result = await bookingCollection.insertOne(booking);
                return res.send({ success: true, message: 'Booking complete' });
            }
        });


        app.get('/available', async (req, res) => {
            const date = req.query.date || 'May 16, 2022';

            //get all services
            const services = await serviceCollection.find().toArray();

            //get the booking of that day
            const query = { date: date };
            const booking = await bookingCollection.find(query).toArray();

            //for each service , find bookings for that service
            services.forEach(service => {
                const serviceBookings = booking.filter(b => b.treatmentName === service.name)
                const booked = serviceBookings.map(book => book.slot);
                //service.booked = serviceBookings.map(s => s.slot);
                //service.booked = booked;
                const availableSlots = service.slots.filter(s => !booked.includes(s));
                service.slots = availableSlots;

            })
            res.send(services);
        });

        //get my appointment by email 
        app.get('/booking', verifyToken, async (req, res) => {
            const patientEmail = req.query.patientEmail;
            const decodedEmail = req.decoded.email;

            if (patientEmail === decodedEmail) {
                const query = { patientEmail: patientEmail };
                const booking = await bookingCollection.find(query).toArray();
                return res.send(booking);
            } else {
                return res.status(403).send({ message: 'Forbidden access' })
            }

        });

        //get booking info by id 
        app.get('/booking/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            result = await bookingCollection.findOne(query);
            res.send(result);
        });


        //for google login use here put method
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };

            const updateDoc = {
                $set: user
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
        });

        //get all users api 
        app.get('/users', verifyToken, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });

        //make admin from users
        app.put('/user/admin/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        //find user by email and check isAdmin is or not 
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';
            res.send({ admin: isAdmin });
        });


        //add doctor api 
        app.post('/doctor', verifyToken, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        //get all doctor api 
        app.get('/doctor', verifyToken, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollection.find().toArray();
            res.send(doctors);
        });

        //delete doctor by their email from url api 
        app.delete('/doctor/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        });


    }
    finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Doctors portal listening on port ${port}`)
})