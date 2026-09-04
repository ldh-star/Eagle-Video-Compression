/**
 * 格式化工具（纯函数，无副作用）
 */
;(function (root) {
    'use strict';

    var UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

    /** 字节 → 可读大小。keepDecimals 可指定小数位，默认自适应 */
    function bytes(n, keepDecimals) {
        if (n === null || n === undefined || isNaN(n)) return '—';
        if (n < 0) return '—';
        if (n === 0) return '0 B';

        var i = 0;
        var v = n;
        while (v >= 1024 && i < UNITS.length - 1) {
            v /= 1024;
            i++;
        }
        var dec = (typeof keepDecimals === 'number')
            ? keepDecimals
            : (i === 0 ? 0 : (v < 10 ? 2 : (v < 100 ? 1 : 0)));
        return v.toFixed(dec) + ' ' + UNITS[i];
    }

    /** 秒 → 00:03:25 / 00:03:25.4 */
    function duration(sec) {
        if (!isFinite(sec) || sec <= 0) return '—';
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = Math.floor(sec % 60);
        var pad = function (x) { return x < 10 ? '0' + x : '' + x; };
        if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
        return pad(m) + ':' + pad(s);
    }

    /** bps → 可读码率 */
    function bitrate(bps) {
        if (!bps || !isFinite(bps)) return '—';
        if (bps >= 1000000) return (bps / 1000000).toFixed(2) + ' Mbps';
        return Math.round(bps / 1000) + ' kbps';
    }

    /** 帧率，整数就不显示小数 */
    function fps(v) {
        if (!v || !isFinite(v)) return '—';
        var rounded = Math.round(v * 100) / 100;
        return (rounded % 1 === 0 ? rounded : rounded.toFixed(2)) + ' fps';
    }

    /** 节省百分比，正数为省下 */
    function savedPercent(orig, now) {
        if (!orig || orig <= 0 || now === null || now === undefined) return 0;
        return (1 - now / orig) * 100;
    }

    /**
     * 按界面的一位小数精度判断体积关系。
     *
     * 0.05% 以内在界面都会显示为 0.0%，此时用成功绿或警告红都会误导用户，
     * 所以归为 same，沿用普通文字颜色。超过该阈值才严格表示变小 / 变大。
     */
    function sizeRelation(orig, now) {
        if (!orig || orig <= 0 || now === null || now === undefined) return 'same';
        var delta = savedPercent(orig, now);
        if (delta > 0.05) return 'smaller';
        if (delta < -0.05) return 'larger';
        return 'same';
    }

    /**
     * 区间预估只有整个区间都低于 / 高于原始体积时才着色。
     * 若区间跨过原始体积，结果尚不确定，显示普通文字颜色。
     */
    function sizeRangeRelation(orig, low, high) {
        if (low === null || low === undefined || high === null || high === undefined) return 'same';
        if (sizeRelation(orig, high) === 'smaller') return 'smaller';
        if (sizeRelation(orig, low) === 'larger') return 'larger';
        return 'same';
    }

    /** 编解码器显示名 */
    function codecName(code) {
        if (!code) return '未知';
        var map = {
            h264: 'H.264', h265: 'H.265', hevc: 'H.265', av1: 'AV1',
            vp9: 'VP9', vp8: 'VP8', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2',
            aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis',
            flac: 'FLAC', pcm_s16le: 'PCM', ac3: 'AC3', eac3: 'E-AC3'
        };
        return map[code] || code.toUpperCase();
    }

    /** 位深显示 */
    function bitDepth(d) {
        return d ? d + '-bit' : '—';
    }

    /**
     * 像素格式 → 人话。
     *
     * ffprobe 给的是 yuv420p / yuv420p10le / yuv422p10le 这种内部字段名，
     * 直接摆在界面上没人看得懂。位深才是用户真正需要知道的信息：
     * 它决定了画面渐变的细腻程度，也决定了换成 H.264 会不会出现色带。
     *
     * 返回 { text, title }：text 是界面上显示的口语文案，title 保留原始
     * 字段值，鼠标悬停可查，排查问题时还能对得上。
     */
    function colorDepth(pixFmt, bitDepthValue) {
        var d = bitDepthValue || 0;

        // 位深没直接给时，从像素格式里反推：
        // yuv420p10le → p10 → 10；yuv422p12le → p12 → 12；yuv420p → 8
        if (!d && pixFmt) {
            var m = /p(\d{2})(le|be)?$/.exec(String(pixFmt));
            if (m) d = parseInt(m[1], 10);
            else if (/^(yuv|nv|gray)/i.test(String(pixFmt))) d = 8;
        }
        if (!d) return null;

        // 就写「10-bit 色深」，不要后缀。用户反馈「（渐变更细腻）」这类注解
        // 是噪音 —— 知道位深的人不需要解释，不知道的人看了也没用。
        return { text: d + '-bit 色深', title: pixFmt || null };
    }

    /**
     * 像素格式 → 通俗的「色彩采样」说法。
     * yuv420p = 4:2:0（最常见），yuv422p = 4:2:2，yuv444p = 4:4:4。
     * 只在非 4:2:0 时才返回，避免给最常见的片子加无谓的噪音。
     */
    function chromaLabel(pixFmt) {
        if (!pixFmt) return null;
        var s = String(pixFmt).toLowerCase();
        if (/^yuv444|^yuvj444/.test(s)) return '4:4:4 全采样';
        if (/^yuv422|^yuvj422/.test(s)) return '4:2:2 采样';
        if (/^yuv420|^yuvj420|^nv12|^nv21/.test(s)) return null;  // 默认，不用提
        if (/^gray/.test(s)) return '黑白';
        return null;
    }

    root.Format = {
        bytes: bytes,
        duration: duration,
        bitrate: bitrate,
        fps: fps,
        savedPercent: savedPercent,
        sizeRelation: sizeRelation,
        sizeRangeRelation: sizeRangeRelation,
        codecName: codecName,
        bitDepth: bitDepth,
        colorDepth: colorDepth,
        chromaLabel: chromaLabel
    };
})(typeof self !== 'undefined' ? self : globalThis);
