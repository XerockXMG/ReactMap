/* eslint-disable no-console */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
const express = require('express')
const path = require('path')
const fs = require('fs')
const logger = require('morgan')
const compression = require('compression')
const session = require('express-session')
const passport = require('passport')
const rateLimit = require('express-rate-limit')
const i18next = require('i18next')
const Backend = require('i18next-fs-backend')
const { ApolloServer } = require('apollo-server-express')
require('./db/initialization')

const { Pokemon } = require('./models/index')
const { sessionStore } = require('./services/sessionStore')
const rootRouter = require('./routes/rootRouter')
const config = require('./services/config')
const typeDefs = require('./graphql/typeDefs')
const resolvers = require('./graphql/resolvers')

const app = express()

const server = new ApolloServer({
  cors: true,
  typeDefs,
  resolvers,
  introspection: config.devOptions.enabled,
  debug: config.devOptions.queryDebug,
  context: ({ req }) => ({ req }),
  formatError: (e) => config.devOptions.enabled
    ? console.error(e)
    : console.error('GraphQL Error: ', e.message, e.path, e.location),
})

server.start().then(() => server.applyMiddleware({ app, path: '/graphql' }))

if (config.devOptions.enabled) {
  app.use(logger((tokens, req, res) => [
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.status(req, res),
    tokens['response-time'](req, res),
    'ms',
    req.user ? `- ${req.user.username}` : 'Not Logged In',
    '-',
    req.headers['x-forwarded-for'],
  ].join(' ')))
}

const RateLimitTime = config.api.rateLimit.time * 60 * 1000
const MaxRequestsPerHour = config.api.rateLimit.requests * (RateLimitTime / 1000)

const rateLimitOptions = {
  windowMs: RateLimitTime, // Time window in milliseconds
  max: MaxRequestsPerHour, // Start blocking after x requests
  headers: true,
  message: {
    status: 429, // optional, of course
    limiter: true,
    type: 'error',
    message: `Too many requests from this IP, please try again in ${config.api.rateLimit.time} minutes.`,
  },
  /* eslint-disable no-unused-vars */
  onLimitReached: (req, res, options) => {
    // eslint-disable-next-line no-console
    console.warn('user is being rate limited')
    res.redirect('/429')
  },
}
const requestRateLimiter = rateLimit(rateLimitOptions)

app.use(compression())

app.use(express.json({ limit: '50mb' }))

app.use(express.static(path.join(__dirname, config.devOptions.clientPath)))

app.use(session({
  name: 'discord',
  key: 'session',
  secret: config.api.sessionSecret,
  store: sessionStore,
  resave: true,
  saveUninitialized: false,
  cookie: { maxAge: 604800000 },
}))

fs.readdir(`${__dirname}/strategies/`, (e, files) => {
  if (e) return console.error(e)
  files.forEach(file => {
    const trimmed = file.replace('.js', '')
    if (config[trimmed]?.enabled) {
      require(`./strategies/${trimmed}`)
      console.log(file, 'strategy initialized')
    } else {
      console.log(file, 'strategy not enabled, if this was a mistake, make sure to add it to the config and enable it')
    }
  })
})

app.use(passport.initialize())

app.use(passport.session())

passport.serializeUser(async (user, done) => {
  done(null, user)
})

passport.deserializeUser(async (user, done) => {
  if (user.perms.map) {
    done(null, user)
  } else {
    done(null, false)
  }
})

i18next.use(Backend).init({
  lng: 'en',
  fallbackLng: 'en',
  preload: config.localeSelection,
  ns: ['translation'],
  defaultNS: 'translation',
  backend: { loadPath: 'public/locales/{{lng}}/{{ns}}.json' },
}, (err, t) => {
  if (err) return console.error(err)
})

app.use(rootRouter, requestRateLimiter)

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Express Error:', err.message)
  switch (err.message) {
    case 'NoCodeProvided':
      return res.redirect('/404')
    case 'Failed to fetch user\'s guilds':
      return res.redirect('/login')
    default:
      return res.redirect('/')
  }
})

if (config.database.settings.reactMapHandlesPvp) {
  Pokemon.initOhbem()
}

app.listen(config.port, config.interface, () => {
  console.log(`Server is now listening at http://${config.interface}:${config.port}`)
})

module.exports = app
