exports.handler = async (event, context) => {
  console.log('🔄 Skool webhook called');
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Body:', event.body);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: 'Method not allowed. Use POST.',
        timestamp: new Date().toISOString()
      })
    };
  }

  try {
    // Parse the body
    let memberData = {};
    if (event.body) {
      memberData = JSON.parse(event.body);
    }

    console.log('📧 Processing member:', memberData);

    // Basic validation
    if (!memberData.email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Email is required',
          timestamp: new Date().toISOString()
        })
      };
    }

    // TODO: Add Firebase integration here later
    // For now, just return success
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Webhook received successfully!',
        timestamp: new Date().toISOString(),
        received: {
          email: memberData.email,
          name: memberData.name || 'Unknown',
          id: memberData.id || 'N/A'
        }
      })
    };

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      })
    };
  }
};