const mongoose = require('../../../../../app/src/infrastructure/Mongoose')

const { Schema } = mongoose
const { ObjectId } = Schema

const TemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String },
    descriptionMD: { type: String },
    author: { type: String },
    authorMD: { type: String },
    license: { type: String, required: true },
    mainFile: { type: String, required: true },
    compiler: { type: String, required: true },
    imageName: { type: String },
    language: { type: String },
    version: { type: Number, default: 1, required: true },
    owner: { type: ObjectId, ref: 'User' },
    lastUpdated: {
      type: Date,
      default() {
        return new Date()
      },
    required: true
    },
  },
  { minimize: false }
)

exports.Template = mongoose.model('Template', TemplateSchema)
exports.TemplateSchema = TemplateSchema
