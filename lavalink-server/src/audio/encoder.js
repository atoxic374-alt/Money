// Lavalink v4 track encoder/decoder
// Binary format: BigEndian, version 3

class TrackEncoder {
    static encode(info) {
        // info: { title, author, length, identifier, isStream, uri, artworkUrl, isrc, sourceName, position }
        const buf = this._encodeTrackData(info);
        // Header: bit 30 set (versioned) | data length (30 bits)
        const header = (1 << 30) | buf.length;
        const result = Buffer.allocUnsafe(4 + buf.length);
        result.writeInt32BE(header, 0);
        buf.copy(result, 4);
        return result.toString('base64');
    }

    static decode(encoded) {
        const buf = Buffer.from(encoded, 'base64');
        const header = buf.readInt32BE(0);
        const versioned = (header & (1 << 30)) !== 0;
        if (!versioned) throw new Error('Unsupported track encoding (not versioned)');
        let offset = 4;
        const version = buf.readUInt8(offset++);
        if (version !== 3) throw new Error(`Unsupported track version: ${version}`);

        const r = new Reader(buf, offset);
        const title = r.readUTF();
        const author = r.readUTF();
        const length = r.readLong();
        const identifier = r.readUTF();
        const isStream = r.readBoolean();
        const hasUri = r.readBoolean();
        const uri = hasUri ? r.readUTF() : null;
        const hasArtwork = r.readBoolean();
        const artworkUrl = hasArtwork ? r.readUTF() : null;
        const hasIsrc = r.readBoolean();
        const isrc = hasIsrc ? r.readUTF() : null;
        const sourceName = r.readUTF();
        const position = r.readLong();

        return {
            encoded,
            info: {
                identifier,
                isSeekable: !isStream,
                author,
                length,
                isStream,
                position,
                title,
                uri,
                artworkUrl,
                isrc,
                sourceName,
            }
        };
    }

    static _encodeTrackData(info) {
        const w = new Writer();
        // version byte
        w.writeByte(3);
        w.writeUTF(info.title || '');
        w.writeUTF(info.author || '');
        w.writeLong(BigInt(Math.floor(info.length || 0)));
        w.writeUTF(info.identifier || '');
        w.writeBoolean(info.isStream || false);
        w.writeBoolean(!!info.uri);
        if (info.uri) w.writeUTF(info.uri);
        w.writeBoolean(!!info.artworkUrl);
        if (info.artworkUrl) w.writeUTF(info.artworkUrl);
        w.writeBoolean(!!info.isrc);
        if (info.isrc) w.writeUTF(info.isrc);
        w.writeUTF(info.sourceName || 'unknown');
        w.writeLong(BigInt(Math.floor(info.position || 0)));
        return w.toBuffer();
    }
}

class Writer {
    constructor() {
        this.chunks = [];
    }

    writeByte(val) {
        const b = Buffer.allocUnsafe(1);
        b.writeUInt8(val & 0xff, 0);
        this.chunks.push(b);
    }

    writeBoolean(val) {
        this.writeByte(val ? 1 : 0);
    }

    writeShort(val) {
        const b = Buffer.allocUnsafe(2);
        b.writeInt16BE(val, 0);
        this.chunks.push(b);
    }

    writeInt(val) {
        const b = Buffer.allocUnsafe(4);
        b.writeInt32BE(val, 0);
        this.chunks.push(b);
    }

    writeLong(val) {
        const b = Buffer.allocUnsafe(8);
        b.writeBigInt64BE(typeof val === 'bigint' ? val : BigInt(val), 0);
        this.chunks.push(b);
    }

    writeUTF(str) {
        const strBuf = Buffer.from(str, 'utf8');
        this.writeShort(strBuf.length);
        this.chunks.push(strBuf);
    }

    toBuffer() {
        return Buffer.concat(this.chunks);
    }
}

class Reader {
    constructor(buf, offset = 0) {
        this.buf = buf;
        this.offset = offset;
    }

    readByte() {
        return this.buf.readUInt8(this.offset++);
    }

    readBoolean() {
        return this.readByte() === 1;
    }

    readShort() {
        const v = this.buf.readInt16BE(this.offset);
        this.offset += 2;
        return v;
    }

    readInt() {
        const v = this.buf.readInt32BE(this.offset);
        this.offset += 4;
        return v;
    }

    readLong() {
        const v = this.buf.readBigInt64BE(this.offset);
        this.offset += 8;
        return Number(v);
    }

    readUTF() {
        const len = this.readShort();
        const str = this.buf.toString('utf8', this.offset, this.offset + len);
        this.offset += len;
        return str;
    }
}

module.exports = { TrackEncoder };
