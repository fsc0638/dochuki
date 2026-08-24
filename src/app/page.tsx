export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">道中記</h1>
        <p className="mt-1 text-sm text-neutral-500">Dōchūki · 旅遊記帳</p>
      </div>
      <p className="text-sm leading-relaxed text-neutral-600">
        資料模型與分攤引擎已就緒（P1）。記帳介面自 P2 起實作。
      </p>
    </main>
  );
}
