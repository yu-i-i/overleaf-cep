import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'
import { ObjectId } from 'mongodb'

// ensure every ObjectId has the id string as a property for correct comparisons
ObjectId.cacheHexString = true

chai.should()
chai.use(chaiAsPromised)
chai.use(sinonChai)
