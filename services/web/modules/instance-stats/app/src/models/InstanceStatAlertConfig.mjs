import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose

// Single-document per-instance alert configuration, editable from the
// Instance Statistics admin page (Settings tab).
//
// _id is fixed to 'instance-stats' (the collection holds exactly one
// document per instance). The doc is upserted the first time the admin
// saves a config; until then there is no document and no alerts.
const InstanceStatAlertConfigSchema = new Schema(
  {
    // Fixed string _id (default Mongoose _id is ObjectId, so the string
    // queries below would throw a CastError otherwise).
    _id: { type: String, default: 'instance-stats' },
    // Recipients of the threshold alert emails (multi-address, 2026-09-01
    // user feedback 3B — "make it possible to add more than one email").
    // Empty list = alerts disabled.
    alertEmails: { type: [String], default: [] },
    // Legacy single recipient (kept for reading pre-3B documents).
    alertEmail: { type: String, default: '' },
    // Alert when disk free space falls below (100 - percent)%.
    diskWarningPercent: { type: Number, default: 90, min: 1, max: 100 },
    // Alert when RAM used exceeds this percentage of total.
    ramWarningPercent: { type: Number, default: 90, min: 1, max: 100 },
    lastDiskAlertAt: { type: Date, default: null },
    lastRamAlertAt: { type: Date, default: null },
  },
  { minimize: false }
)

export const InstanceStatAlertConfig = mongoose.model(
  'InstanceStatAlertConfig',
  InstanceStatAlertConfigSchema,
  'instanceStatAlertConfigs'
)

/** Fixed _id for the single per-instance config document. */
export const ALERT_CONFIG_ID = 'instance-stats'
