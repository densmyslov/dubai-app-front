import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body: any = await request.json();
    console.log('Webhook received:', body);

    // Broadcast the message to connected clients
    if ((global as any).broadcastMessage) {
      (global as any).broadcastMessage({
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
