import mongoose from '../infrastructure/Mongoose.mjs'

const { Schema } = mongoose

const InstanceStatSchema = new Schema(
  {
    // Metric identifier
    statKey: { type: String, required: true, index: true },
    // Day bucket (stored as a Date; comparisons should use UTC midnight)
    day: { type: Date, required: true, index: true },
    // Values for the stacked bar series.
    // For 1-series metrics: [y1]
    // For 2-series metrics: [y1, y2]
    values: { type: [Number], required: true, default: [] },
    generatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { minimize: false }
)

InstanceStatSchema.index({ statKey: 1, day: 1 }, { unique: true })

export const InstanceStat = mongoose.model(
  'InstanceStat',
  InstanceStatSchema,
  'instanceStats'
)

