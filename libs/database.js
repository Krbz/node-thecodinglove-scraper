const mongoose = require('mongoose');
const database = require('../config/database.json');

const env = process.env.NODE_ENV || 'production';
const db = database[env].main;
const url = `${db.adapter}://${db.user}:${db.password}@${db.host}:${db.port}/${db.database}`;

function connect() {
    const options = { server: { socketOptions: { keepAlive: 1 } } };

    console.info('Connecting to database...');

    return mongoose.connect(url, options)
        .connection
        .on('error', error)
        .on('disconnected', disconnected)
        .on('connected', connected);
}

function error (err) {
    console.log(`Mongoose default connection error: ${err}`);
    exit();
}

function connected () {
    console.log(`Mongoose default connection open to: ${url}`);

    /**
     * If the Node process ends, close the Mongoose connection
     */
    process.on('SIGINT', function() {
        console.log('SIGINT');

        mongoose.connection.close(() => {
            console.log('Mongoose default connection disconnected through app termination');
            exit();
        });
    });
}

function disconnected () {
    console.log('Mongoose default connection disconnected');
    exit();
}

function exit () {
    process.exit(0);
}

module.exports = connect;
