const hasRole = require('../lib/hasRole');

module.exports = function authorizeData(data, action, user) {

  let self = this;

  try {
    
    if (!self.rawAttributes) throw 'empty';
    if (!user) user = self.auth && self.auth.user;
    if (!user || !user.role) user = { role: 'all' };

    // TODO: dit is een check op jezelf, nu kan de argument:view check uit de routes
    if (!self.can(action, user))  throw 'empty';

    let keys = Object.keys( data );

    let result = {};
    keys.forEach((key) => {

      let testRole;
      if (self.rawAttributes[key] && self.rawAttributes[key].auth) {
        if (self.rawAttributes[key].auth.authorizeData) {
          data[key] = self.rawAttributes[key].auth.authorizeData(self, action, user, data[key]);
        } else {
          testRole = self.rawAttributes[key].auth[action+'ableBy'];
        }
      }
      testRole = testRole || ( self.auth && self.auth[action+'ableBy'] );
      if ( !hasRole(user, testRole, self.userId)) {
        data[key] = undefined;
      }

    });

  } catch (err) {
    emptyResult();
  } finally {
    return self;
  }

  function emptyResult() {
    Object.keys( data ).forEach((key) => {
      data[key] = undefined;
    });
    
  }

}
