const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express()
require('dotenv').config()
const port = process.env.PORT || 5000



//middleware 
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.p9ooz.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyToken(req, res, next) {
    console.log('hi');
}

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const usersCollection = client.db('doctors_portal').collection('users');

        app.get('/service', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query);
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
            const authorization = req.headers.authorization;
            console.log('auth headers', authorization);
            const query = { patientEmail: patientEmail };
            const booking = await bookingCollection.find(query).toArray();
            res.send(booking);
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