import mongoose from 'mongoose';

export async function connectToDatabase(uri: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}

