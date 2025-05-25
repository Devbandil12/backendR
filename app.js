require("dotenv").config();
const cors = require("cors")


const app = require('express')();
var http = require('http').Server(app);

app.use(cors({
    origin:"*"
}))
const paymentRoute = require('./routes/paymentRoute');

app.use('/',paymentRoute.payment_routes);

http.listen(3000, function(){
    console.log('Server is running');
});
