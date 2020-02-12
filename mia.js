class MIA {
    constructor(options) {
        this.data = options.data;
        this.$root = document.querySelector(options.el);
        this.method = options.method;
        this.sp = new StrategyPool(this.data);
        this.initData();
    }

    initData() {
        this.eachNode(this.$root);
        let pool = this.sp.pool;
        let keys = Object.keys(pool);
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            let methods = pool[key];
            this.defineProperty(this.data, key, this.data[key], methods);
            methods.forEach((method) => { method.do() })
        }
    }

    defineProperty(data, key, value, methods) {
        Object.defineProperty(data, key, {
            enumerable: true,
            configurable: false,
            set: function (newVal) {
                if (newVal === value) return;
                value = newVal;
                methods.forEach((method) => { method.do() })
            },
            get: function () {
                return value;
            }
        });
    }

    eachNode(node) {
        switch (node.nodeType) {
            // 普通元素
            case Node.ELEMENT_NODE:
                this.sp.elementNodeRegister(node);
                break;
            // 文本节点
            case Node.TEXT_NODE:
                this.sp.textNodeRegister(node);
                break;
        }
        // 递归
        let childNodes = node.childNodes;
        if (childNodes) {
            for (let index = 0; index < childNodes.length; index++) {
                this.eachNode(childNodes[index]);
            }
        }
    }
}

class StrategyPool {
    constructor(data) {
        this.pool = {};
        this.exp = {
            text: /\{\{\s?(.[^\}\s]*)\s?\}\}/
        }
        this.data = data;
    }

    textNodeRegister(node) {
        const txt = node.textContent;
        let tempTxt = node.textContent;
        let keys = []; let methodss = [];
        while (this.exp.text.test(tempTxt)) {
            let key = this.exp.text.exec(tempTxt)[1].trim();
            if (/^[\w\d]*$/.test(key)) {//如果是纯字母组合
                let methods = (this.pool[key]) || (this.pool[key] = []);
                keys.push(key);
                methodss.push(methods);
                //消除当前key
                tempTxt = tempTxt.replace(new RegExp("\\{\\{\\s?(" + key + "[^\\}\\s]*)\\s?\\}\\}", "gm"), "")
            } else {//todo 运算符处理
                console.log("运算符待处理");
            }
        };
        methodss.forEach(methods => {
            methods.push(new TextProcesser(keys, node, txt, this.data))
        });
    }

    elementNodeRegister(node) {

    }

}

class TextProcesser {
    constructor(keys, node, text, data) {
        this.node = node;
        this.textSource = text;
        this.keys = keys;
        this.data = data
        this.nExps = [];
        for (let index = 0; index < this.keys.length; index++) {
            this.nExps[index] = new RegExp("\\{\\{\\s?(" + this.keys[index] + "[^\\}\\s]*)\\s?\\}\\}", "gm");
        }
    }

    do() {
        let text = this.textSource;
        for (let index = 0; index < this.keys.length; index++) {
            const key = this.keys[index];
            const nExp = this.nExps[index];
            text = text.replace(nExp, this.data[key]);
        }
        this.node.textContent = text;
    }
}