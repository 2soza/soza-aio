const test = require('node:test');
const assert = require('node:assert/strict');
const { createZipArchive } = require('../utils/zipArchive');

test('ZIP archive contains downloadable files and a central directory', () => {
    const archive = createZipArchive([
        { name: '1-image.png', data: Buffer.from('image bytes') },
        { name: '2-notes.txt', data: Buffer.from('notes') }
    ], new Date('2026-10-28T09:00:00.000Z'));

    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
    assert.equal(archive.readUInt16LE(archive.length - 12), 2);
    assert.ok(archive.includes(Buffer.from('1-image.png')));
    assert.ok(archive.includes(Buffer.from('2-notes.txt')));
    assert.ok(archive.includes(Buffer.from('image bytes')));
    assert.ok(archive.includes(Buffer.from('notes')));
});

test('ZIP archive requires at least one file with Buffer data', () => {
    assert.throws(() => createZipArchive([]), /at least one file/);
    assert.throws(() => createZipArchive([{ name: 'bad.txt', data: 'not a buffer' }]), /Buffer/);
});
