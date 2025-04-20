require("dotenv").config();
const cors = require("cors")


const app = require('express')();
var http = require('http').Server(app);

app.use(cors({
    origin:"https://www.devidaura.com/"
}))
const paymentRoute = require('./routes/paymentRoute');

app.use('/',paymentRoute);

http.listen(3000, function(){
    console.log('Server is running');
});
