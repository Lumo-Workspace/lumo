// LUM-852 TC1 production probe — throwaway, never merged. Gives the hunt a
// request-controlled URL reaching fetch so the exploit-path layer runs.
export async function GET(req: Request): Promise<Response> {
  const target = new URL(req.url).searchParams.get('target') ?? ''
  const upstream = await fetch(target)
  return new Response(await upstream.text())
}
