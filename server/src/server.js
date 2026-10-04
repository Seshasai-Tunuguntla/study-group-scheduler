require('dotenv').config({ quiet: true });
const app = require('./app');

const PORT = process.env.PORT || 4100;

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
