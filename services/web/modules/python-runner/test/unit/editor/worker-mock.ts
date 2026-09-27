type WorkerMessageListener = (event: MessageEvent) => void

export class WorkerMock {
  static instances: WorkerMock[] = []

  readonly postedMessages: any[] = []
  terminated = false
  private messageListeners: WorkerMessageListener[] = []

  constructor() {
    WorkerMock.instances.push(this)
  }

  addEventListener(type: string, listener: WorkerMessageListener) {
    if (type === 'message') {
      this.messageListeners.push(listener)
    }
  }

  postMessage(message: unknown) {
    this.postedMessages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emitMessage(message: unknown) {
    for (const listener of this.messageListeners) {
      listener({ data: message, target: this } as unknown as MessageEvent)
    }
  }
}

export const createWorker = () => new WorkerMock() as unknown as Worker
