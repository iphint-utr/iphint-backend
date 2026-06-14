import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPayment extends Document {
  userId: Types.ObjectId;
  subscriptionPlanId?: Types.ObjectId;
  amount: number;
  currency: string;
  status: 'completed' | 'failed' | 'refunded';
  paddleTransactionId: string;         
  paddleSubscriptionId?: string;     
  createdAt: Date;
}

const PaymentSchema = new Schema<IPayment>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subscriptionPlanId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  status: { type: String, enum: ['completed', 'failed', 'refunded'], required: true },
  
paddleTransactionId: { type: String, required: true, unique: true },
paddleSubscriptionId: { type: String }, 
  createdAt: { type: Date, default: Date.now },
});

export const ensurePaymentIndexes = async () => {
  const collection = mongoose.connection.collection('payments');

  // Legacy PayPal-only unique index can block Paddle rows where paypalOrderId is absent/null.
  // Remove it once so inserts/upserts keyed by paddleTransactionId work reliably.
  try {
    const indexes = await collection.indexes();
    const hasLegacyPaypalIndex = indexes.some((idx) => idx.name === 'paypalOrderId_1');
    if (hasLegacyPaypalIndex) {
      await collection.dropIndex('paypalOrderId_1');
      console.log('[Payment] Dropped legacy index: paypalOrderId_1');
    }
  } catch (error: any) {
    // Namespace not found means the collection doesn't exist yet; that's safe to ignore.
    if (error?.codeName !== 'NamespaceNotFound') {
      throw error;
    }
  }
};

export const Payment = mongoose.models.Payment || mongoose.model<IPayment>('Payment', PaymentSchema);