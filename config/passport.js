const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const prisma = require('./prisma');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: " https://nwvlgy3m4q02-production-v9cdeall.us-central1.suga.run/api/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;

      // 1. Look for user by Google ID
      let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
      if (user) return done(null, user);

      // 2. Look for user by Email (in case they signed up before)
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // Link their Google ID to their existing account
        user = await prisma.user.update({
          where: { email },
          data: { googleId: profile.id }
        });
        return done(null, user);
      }

      // 3. Create a brand new user (No password needed!)
      user = await prisma.user.create({
        data: {
          googleId: profile.id,
          email: email,
          name: profile.displayName,
          emailVerified: true // Google already verified them
        }
      });
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

module.exports = passport;