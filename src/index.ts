export default {
  async fetch(): Promise<Response> {
    return Response.json({ success: false, error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }, { status: 404 });
  },
};
