import { useEffect } from 'react'
import { useDeviceStore } from './store/deviceStore'
import { RoomSimulator } from './components/RoomSimulator'
import { ChatPanel } from './components/ChatPanel'

export default function App() {
  const connectWebSocket = useDeviceStore((s) => s.connectWebSocket)
  const connectDialogueWebSocket = useDeviceStore(
    (s) => s.connectDialogueWebSocket,
  )
  const loadRecentDialogues = useDeviceStore((s) => s.loadRecentDialogues)

  useEffect(() => {
    connectWebSocket()
    void loadRecentDialogues()
    connectDialogueWebSocket()
  }, [connectWebSocket, connectDialogueWebSocket, loadRecentDialogues])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-100">
      <main className="min-w-0 flex-1">
        <RoomSimulator />
      </main>

      <ChatPanel />
    </div>
  )
}