import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body: any = await request.json();
    console.log('Webhook received:', body);

    // Broadcast the message to clients connected to the 'global' session.
    if ((global as any).broadcastWebhookMessage) {
      (global as any).broadcastWebhookMessage('global', {
        id: new Date().toISOString(),
        text: body.message || 'No message content',
      });
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
