const fs = require('fs');
<<<<<<< HEAD
const key = fs.readFileSync('./firebase-admin-key.json', 'utf8');
=======
const key = fs.readFileSync('./firebase_service_key.json', 'utf8');
>>>>>>> 3faf674ebaeeae2a77d534c0899b76161670bb65
const base64 = Buffer.from(key).toString('base64')
console.log(base64)