import { useEffect } from 'react'
import { useDeviceStore } from './store/deviceStore'
import { RoomSimulator } from './components/RoomSimulator'
import { ChatPanel } from './components/ChatPanel'

export default function App() {
  const connectWebSocket = useDeviceStore((s) => s.connectWebSocket)

  useEffect(() => {
    connectWebSocket()
  }, [connectWebSocket])

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <RoomSimulator />
      <ChatPanel />
    </div>
  )
}
