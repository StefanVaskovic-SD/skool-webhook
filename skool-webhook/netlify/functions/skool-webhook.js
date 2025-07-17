const admin = require('firebase-admin');

// Inicijalizuj Firebase Admin samo jednom
if (!admin.apps.length) {
  console.log('🔥 Inicijalizujem Firebase...');
  console.log('Project ID:', process.env.FIREBASE_PROJECT_ID);
  console.log('Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
  console.log('Private Key length:', process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.length : 'undefined');
  
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    databaseURL: "https://podclub-bdcc9-default-rtdb.firebaseio.com"
  });
  console.log('✅ Firebase inicijalizovan');
}

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

    console.log('📧 RAW received data:', JSON.stringify(memberData, null, 2));
    console.log('📧 Available fields:', Object.keys(memberData));

    // Try different email field names
    const email = memberData.email || memberData.Email || memberData.member_email || memberData.user_email;
    
    console.log('📧 Extracted email:', email);

    // Basic validation
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Email is required',
          received_data: memberData,
          available_fields: Object.keys(memberData),
          timestamp: new Date().toISOString()
        })
      };
    }

    // Update memberData with extracted email
    memberData.email = email;

    // Sinhronizuj sa Firebase
    const result = await syncSkoolMemberToFirebase(memberData);

    if (result.success) {
      console.log('✅ Sinhronizacija uspešna');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Član uspešno sinhronizovan sa Firebase',
          timestamp: new Date().toISOString(),
          userId: result.userId,
          authUserId: result.authUserId,
          action: result.action
        })
      };
    } else {
      console.error('❌ Sinhronizacija neuspešna:', result.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: `Firebase sync failed: ${result.error}`,
          timestamp: new Date().toISOString()
        })
      };
    }

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: `Internal server error: ${error.message}`,
        timestamp: new Date().toISOString()
      })
    };
  }
};

async function syncSkoolMemberToFirebase(memberData) {
  console.log('🔄 Sinhronizujem Skool člana sa Firebase:', memberData);

  try {
    const db = admin.firestore();
    const auth = admin.auth();

    const email = memberData.email;
    const name = memberData.name || memberData.full_name || email.split('@')[0];
    const skoolId = memberData.id || memberData.user_id || memberData.member_id;

    console.log('📝 Obrađujem:', { email, name, skoolId });

    // 1. PROVJERI FIRESTORE
    const usersRef = db.collection('users');
    const userQuery = await usersRef.where('email', '==', email).get();

    let userId;
    let action;

    if (!userQuery.empty) {
      // Ažuriraj postojećeg korisnika
      const userDoc = userQuery.docs[0];
      userId = userDoc.id;
      action = 'updated';
      
      await userDoc.ref.update({
        skoolMember: true,
        skoolId: skoolId,
        skoolJoinDate: admin.firestore.FieldValue.serverTimestamp(),
        skoolStatus: 'active',
        lastSyncFromSkool: admin.firestore.FieldValue.serverTimestamp(),
        skoolData: {
          joinMethod: 'direct_skool',
          syncDate: new Date().toISOString(),
          originalData: memberData
        }
      });
      
      console.log('✅ Postojeći korisnik ažuriran:', userId);
    } else {
      // Kreiraj novog korisnika
      action = 'created';
      const newUserData = {
        email: email,
        name: name,
        skoolMember: true,
        skoolId: skoolId,
        skoolJoinDate: admin.firestore.FieldValue.serverTimestamp(),
        skoolStatus: 'active',
        isPaid: memberData.isPaid || false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'skool_direct',
        lastSyncFromSkool: admin.firestore.FieldValue.serverTimestamp(),
        skoolData: {
          joinMethod: 'direct_skool',
          syncDate: new Date().toISOString(),
          originalData: memberData
        }
      };
      
      const newUserRef = await usersRef.add(newUserData);
      userId = newUserRef.id;
      console.log('✅ Novi korisnik kreiran:', userId);
    }

    // 2. PROVJERI FIREBASE AUTH
    let authUser;
    try {
      authUser = await auth.getUserByEmail(email);
      console.log('👤 Auth korisnik već postoji:', authUser.uid);
      
      // Ažuriraj custom claims
      await auth.setCustomUserClaims(authUser.uid, {
        skoolMember: true,
        skoolId: skoolId,
        isPaid: memberData.isPaid || false
      });
      
    } catch (authError) {
      if (authError.code === 'auth/user-not-found') {
        console.log('👤 Kreiram novi auth nalog');
        
        // Generiši privremeni password
        const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
        
        authUser = await auth.createUser({
          email: email,
          displayName: name,
          password: tempPassword,
          emailVerified: false
        });
        
        // Postavi custom claims
        await auth.setCustomUserClaims(authUser.uid, {
          skoolMember: true,
          skoolId: skoolId,
          isPaid: memberData.isPaid || false,
          needsPasswordReset: true
        });
        
        console.log('✅ Novi auth korisnik kreiran:', authUser.uid);
      } else {
        throw authError;
      }
    }

    // 3. AŽURIRAJ FIRESTORE SA AUTH UID
    if (action === 'updated') {
      const userDoc = userQuery.docs[0];
      await userDoc.ref.update({
        firebaseAuthId: authUser.uid,
        lastAuthSync: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await usersRef.doc(userId).update({
        firebaseAuthId: authUser.uid,
        lastAuthSync: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    console.log('✅ Sinhronizacija završena uspešno');

    return {
      success: true,
      userId: userId,
      authUserId: authUser.uid,
      action: action
    };

  } catch (error) {
    console.error('❌ Greška pri sinhronizaciji:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
