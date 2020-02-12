class MIA {
    constructor(options) {
        this.data = options.data;
        this.$root = document.querySelector(options.el);
        this.method = options.method;
        this.sp = new StrategyPool(this.data);
        this.initData(); //初始化
    }

    initData() {
        // 遍历每个节点，将对应的处理策略注册到策略池中,通过this.data中的字段来引用这些处理策略
        this.eachNode(this.$root);
        // 修改this.data中每个字段以及子字段的set方法，当给这些字段设置值(=)的时候，触发策略池中的处理策略
        this.defineProperty(this, "__skip__", this.data, "");
    }

    defineProperty(data, key, value, fullKey) {
        if (key !== "__skip__") {
            let processors = this.sp.pool[fullKey];
            Object.defineProperty(data, key, {
                enumerable: true,
                configurable: false,
                set: function (newVal) {
                    if (newVal === value) return;
                    value = newVal;
                    processors.forEach((processor) => { processor.do() })
                },
                get: function () {
                    return value;
                }
            });
            (processors) && (processors.forEach((processor) => { processor.init() }))
        }
        if (value instanceof Object) {
            let keys = Object.keys(value);
            for (let index = 0; index < keys.length; index++) {
                const key = keys[index];
                let newFullKey = (fullKey) ? fullKey + "." + key : key;
                this.defineProperty(value, key, value[key], newFullKey);
            }
        }
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
        let childNodes;
        if (node.hasChildNodes() && (childNodes = node.childNodes)) {
            for (let index = 0; index < childNodes.length; index++) {
                this.eachNode(childNodes[index]);
            }
        }
    }
}

// 策略池，当初始化时，遍历每一个元素时都会通过策略池来决定要注册的事件
class StrategyPool {
    constructor(data) {
        // 策略池，{key : [processor1, processor2..], key2: {processor1, processor2..}}
        this.pool = {};
        // 正则表达式
        this.exp = {
            text: /\{\{\s?(.[^\}\s]*)\s?\}\}/
        }
        // 引用MIA options中的data
        this.data = data;

        // 特定属性
        this.specialAttrs = ["v-model", "v-value", "v-text"];
        // 拥有该属性的元素的渲染方式，当options.data中的字段的值被修改后自动执行对应方法修改该元素的相关内容
        this.specialMethod = {
            "v-model": function (element) {
                switch (element.type) {
                    case "checkbox":
                        return (packet) => { packet.node.checked = (StrategyPool.val(packet.data, packet.key)) ? "checked" : "" };
                        break;
                    default:
                        return (packet) => { packet.node.value = StrategyPool.val(packet.data, packet.key) };
                        break;
                }
            }
        };

        // 拥有该属性的元素的初始化方法，修改该元素的相关内容为options.data中对应的字段的值，并且注册事件
        this.specialInitMethod = {
            "v-model": function (element) {
                switch (element.type) {
                    case "checkbox":
                        return (packet) => {
                            packet.node.checked = (StrategyPool.val(packet.data, packet.key)) ? "checked" : "";
                            packet.node.addEventListener("input", () => { StrategyPool.val(packet.data, packet.key, (packet.node.checked)) })
                        }
                        break;
                    default:
                        return (packet) => {
                            packet.node.value = StrategyPool.val(packet.data, packet.key);
                            packet.node.addEventListener("input", () => { StrategyPool.val(packet.data, packet.key, packet.node.value) })
                        }
                        break;
                }
            }
        };
    }

    //将文本节点的处理策略(TextProcessor)注册到策略池(StrategyPool.pool)中
    textNodeRegister(node) {
        const txt = node.textContent; // 永久记录该文本节点的内容初始值
        let tempTxt = node.textContent; // 此处获取该文本节点的内容，用来查询其中出现的所有key，即options中的data字段
        let keys = []; // 当前文本中包含的所有key，即options中的data的字段
        let PcSorCollector = []; // 用于收集每个key对应的处理器集合，相当于二维数组
        while (this.exp.text.test(tempTxt)) {
            let key = this.exp.text.exec(tempTxt)[1].trim();
            if (/^[\w\d\.]*$/.test(key)) {//如果是纯字母组合
                let processors = (this.pool[key]) || (this.pool[key] = []);
                keys.push(key);
                PcSorCollector.push(processors);
                //消除当前key
                tempTxt = tempTxt.replace(new RegExp("\\{\\{\\s?(" + key + "[^\\}\\s]*)\\s?\\}\\}", "gm"), "")
            } else {//todo 运算符处理
                console.log("运算符待处理");
            }
        };
        PcSorCollector.forEach(processors => {
            processors.push(new TextProcessor(keys, node, txt, this.data))
        });
    }

    elementNodeRegister(element) {
        let attributes = element.attributes;
        let attrCollector = []; // 收集有用属性
        for (let index = 0; index < attributes.length; index++) {
            const attr = attributes[index];
            if (this.specialAttrs.indexOf(attr.name) != -1) {
                attrCollector.push({ index: index, name: attr.name, value: attr.value });
            }
        }

        if (attrCollector.length == 0) return;

        for (let index = 0; index < attrCollector.length; index++) {
            const key = attrCollector[index].value;
            const name = attrCollector[index].name;

            if (/^[\w\d\.]*$/.test(key)) {
                let processors = (this.pool[key]) || (this.pool[key] = []);
                processors.push(new ElementProcessor(key, element, this.data, this.specialMethod[name](element), this.specialInitMethod[name](element)));
            } else {//todo 运算符处理
                console.log("运算符待处理");
            }
        }
    }

    // 通过复杂key(options.data.more.m1)给从options.data中对应的字段设置的值
    static val(data, complexKey, newVal) {
        let hierarchy = complexKey.split(".");
        let value = data;
        if (newVal === undefined) {
            for (let index = 0; index < hierarchy.length; index++) {
                const key = hierarchy[index];
                value = value[key];
            }
            return value;
        } else {
            for (let index = 0; index < hierarchy.length - 1; index++) {
                const key = hierarchy[index];
                value = value[key];
            }
            value[hierarchy[hierarchy.length - 1]] = newVal;
            return newVal;
        }
    }
}

class TextProcessor {
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
            text = text.replace(nExp, StrategyPool.val(this.data, key));
        }
        this.node.textContent = text;
    }

    init() {
        this.do();
    }
}

class ElementProcessor {
    constructor(key, node, data, method, initMethod) {
        this.node = node;
        this.key = key;
        this.data = data;
        this.method = method;
        this.initMethod = initMethod;
    }

    do() {
        this.method(this);
    }

    init() {
        this.initMethod(this);
    }
}