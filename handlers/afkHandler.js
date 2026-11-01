// AFK no longer uses buttons or modals (the Koya-style AFK is plain text),
// so this handler has nothing to do. It is kept only because main.js still
// requires './handlers/afkHandler'. If you remove that require from main.js,
// you can delete this file.
module.exports = {
    name: 'interactionCreate',
    async execute() {}
};
