import admin from "firebase-admin";
import { readFileSync } from "fs";


const serviceAccount = JSON.parse(readFileSync("./config/serviceAccount.json", "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://roprapp-cluster-default-rtdb.europe-west1.firebasedatabase.app/", 
});

export default admin;
