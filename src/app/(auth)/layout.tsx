export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
      <h1 className="font-serif text-2xl text-stamp">道中記</h1>
      {children}
    </main>
  );
}
