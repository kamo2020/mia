class MIA {
    constructor(options) {
        this.initMethod = options.init;
        this.data = options.data;
        this.root = document.querySelector(options.el);
        this.method = options.method;
        this.sp = new StrategyPool(this);
        this.initData(); //初始化
    }

    initData() {
        // 遍历每个节点，将对应的处理策略注册到策略池中,通过this.data中的字段来引用这些处理策略
        this.eachNode(this.root);
        this.convertProxy("");
        this.referenceMethod();
        (this.initMethod) && Reflect.apply(this.initMethod, this.data, [this.method]);
    }

    // 将key对应的值转换为一个代理对象
    convertProxy(complexKey) {
        let value = (complexKey) ? StrategyPool.val(this.data, complexKey) : this.data;
        if (value instanceof Object) {
            // 给当前对象添加一个属性keyPrefix，这个属性将和被set的属性拼接，形成一个复杂key,通过这个复杂key可以从策略池中获取其对应的策略数组，然后依次执行数组中的这些策略
            let keyPrefix = (complexKey) ? complexKey + "." : "";
            let proxy = null;
            if (value.I_isProxy_I) {//如果此对象是一个代理对象
                if (value.__prefix__.indexOf(keyPrefix) === -1) {
                    value.__prefix__.push(keyPrefix);
                }
                proxy = value;
            } else {
                proxy = this.createProxy(value, keyPrefix);
                if (complexKey) {
                    StrategyPool.val(this.data, complexKey, proxy);
                } else {
                    this.data = proxy;
                }
            }
            // 递归
            let keys = [].filter.call(Object.keys(proxy), (key) => { return ["__prefix__", "I_isProxy_I", "push", "splice", ""].indexOf(key) == -1 });
            if (Array.isArray(proxy)) { keys.push("length") };
            for (let key of keys) {
                for (let prefix of proxy.__prefix__) {
                    this.convertProxy(prefix + key);
                }
            }
        } else {
            StrategyPool.pcSorProxySlave(complexKey, this.sp.pool);
        }

    }

    // 创建代理对象
    createProxy(value, keyPrefix) {
        // 以value这个对象为基本，创建一个代理对象，这个代理对象重写了这个对象的set方法，当这个对象的某个属性被赋值时，调用这个重写的set方法，然后执行对应的策略
        let proxy = new Proxy(value, {
            set: (target, property, value, receiver) => {
                // 如果新值与旧值相等，则直接返回即可，不再执行下面的操作
                if (target[property] === value) return true;
                // 常规的进行赋值
                target[property] = value;

                if ((property !== "__prefix__") && (target[property] instanceof Object) && (!(target[property] instanceof Function))) {
                    // 如果原值是一个对象，但不是代理对象，则创建代理对象
                    receiver.__prefix__.forEach(prefix => { this.convertProxy(prefix + property) });
                }
                // 赋值完成后，开始调用这个属性的相关策略
                StrategyPool.pcSorProxy(receiver.__prefix__, property, this.sp.pool);
                return true;
            }
        });

        proxy.__prefix__ = (keyPrefix) ? [keyPrefix] : [""];
        proxy.I_isProxy_I = true;
        // 数组变动的监视
        if (Array.isArray(proxy)) {
            ["push", "splice"].forEach(methodName => {
                let method = Array.prototype[methodName];
                proxy[methodName] = new Proxy(method, {
                    apply: (target, thisArg, argumentsList) => {
                        Reflect.apply(target, thisArg, argumentsList);
                        let keys = thisArg.__prefix__.map(key => key.match(/(.*)\b\.{0,1}$/)[1]);
                        let keysWithLength = thisArg.__prefix__.map(key => key + "length");
                        StrategyPool.pcSorProxy([...keys, ...keysWithLength], "", this.sp.pool);
                    }
                });
            })
        }
        return proxy;
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
        if ((!node.__discard__) && node.hasChildNodes() && (childNodes = node.childNodes)) {
            for (let index = 0; index < childNodes.length; index++) {
                this.eachNode(childNodes[index]);
            }
        }
    }

    referenceMethod() {
        Object.keys(this.method).forEach(key => this.data[key] = this.method[key]);
    }
}

// 正则表达式
const _RegExpPool = {
    text: /\{\{\s?(.[^\}\s]*)\s?\}\}/,
    key: /^[\w\d\._]+$/,
    methodWithParam: /[\w\d]+\(.+\)$/,
    extractMethodName: /^([\w\d]+)\(.*/,
    extractParam: /[\w\d]+\([\s]?(.*)[\s]?\)$/,
    splitParam: /,\s*/,
    integerExp: /^\d+$/,
    stringExp: /^["']{1}(.+)["']{1}$/,
    referenceExp: /^[\w\d\._]+$/,
    eachExpression: /^[\s\(]*([^\)]*)[\s\)]*<\s*([\d\w\._]*)\s?$/,
    eachAttr: /each:[^;]*;?/
};

// 策略池，当初始化时，遍历每一个元素时都会通过策略池来决定要注册的事件
class StrategyPool {
    constructor(mia) {
        // 直接将MIA的实例对象传入进来，这样方便在底层操作的时候能引用到最新的数据
        this.mia = mia;
        // 策略池，{key : [processor1, processor2..], key2: {processor1, processor2..}}
        this.pool = {};

        // 特定属性
        this.specialAttrs = ["each", "model", "value", "text", "event"];

        // 拥有该属性的元素的渲染方式，当options.data中的字段的值被修改后自动执行对应方法修改该元素的相关内容
        // 拥有该属性的元素的初始化方法，修改该元素的相关内容为options.data中对应的字段的值，并且注册事件
        this.specialInitMethod = {
            "model": function (attrVal, element) {
                let key;
                switch (element.type) {
                    case "checkbox":
                        let sameCheckBox = document.querySelectorAll("input[type='checkbox'][mia~='" + attrVal + "']");
                        key = sameCheckBox.length > 1 ? "complexCheckBox" : "singleCheckBox";
                        break;
                    case "radio":
                        key = "radio";
                        break;
                    default:
                        key = "common";
                }
                let processors = this.pool[attrVal] || (this.pool[attrVal] = []);
                processors.push(new ElementProcessor(attrVal, element, this.mia, this.setter[key], this.trigger[key]));
            },
            "value": function (attrVal, element) {
                let processors = this.pool[attrVal] || (this.pool[attrVal] = []);
                processors.push(new ElementProcessor(attrVal, element, this.mia, this.setter["value"], this.trigger["value"]));
            },
            "each": function (expression, element) {
                let [keyExpression, eachSource] = [].map.call(expression.split(/</), o => o.trim());
                let anchorNode = document.createElement("anchor");
                element.parentNode.replaceChild(anchorNode, element);
                let processor = new EachProcessor(element.cloneNode(true), anchorNode, this.mia, eachSource, keyExpression);
                let processors = this.pool[eachSource] || (this.pool[eachSource] = []);
                processors.push(processor);
                element.__discard__ = true;// 丢弃该元素不再继续处理
            },
            "event": function (expression, element) {
                let [eventName, methodExpression] = [].map.call(expression.split(">"), expression => expression.trim());
                if (_RegExpPool.key.test(methodExpression)) {// 如果是单纯的变量名类型，表示调用的是无参方法，直接添加事件即可
                    element.addEventListener(eventName, (event) => { Reflect.apply(this.mia.method[methodExpression], this.mia.data, [event]) });
                }
                else if (_RegExpPool.methodWithParam.test(methodExpression)) {// 如果该字符串中类似("method(str)"),说明调用的是带参数的方法
                    // 提取该字符串中表示参数的部分，最终变成一个参数数组，但是这个数组全部都是字符串类型的数据，因此需要继续处理
                    let params = methodExpression.match(_RegExpPool.extractParam)[1].split(_RegExpPool.splitParam);
                    // 这个数组存储的是上面的参数的处理方法，当调用后的返回值是真正的参数
                    let args = [];
                    for (let index = 0; index < params.length; index++) {
                        let param = params[index];
                        if (_RegExpPool.integerExp.test(param)) {// 如果该参数是纯数字，解析该数字即可 todo double类型的还不支持
                            param = parseInt(param);
                            // 这里实际存储的是一个方法，当调用该方法后才返回真正的参数，这样做是为了适配引用类型的数据，因为引用类型的数据的动态的，每次执行的结果都不同
                            args[index] = () => { return param };
                        } else if (_RegExpPool.stringExp.test(param)) {// 如果该参数是字符串类型的，类似这种('西瓜')
                            param = param.replace(/["']/g, "");
                            args[index] = () => { return param };
                        } else if (_RegExpPool.referenceExp.test(param)) {// 如果该参数是引用数据类型的，只是单纯的变量名(title, more.m1)
                            args[index] = () => { return StrategyPool.val(this.mia.data, param) };
                        }
                    }
                    // 当参数处理完毕后，得到一个args数组，这个数组中存储的都是方法，当调用后获取真正的参数
                    // arrtName.split(":")[1] 这里会得到事件类型(click, input, change)
                    // () => { this.method[attrVal.match(this.exp.extractMethodName)[1]](...[].map.call(args, (arg) => { return arg() })) }
                    // 该事件要执行的方法 this.method[attrVal.match(this.exp.extractMethodName)[1]]
                    // 参数列表 (...[].map.call(args, (arg) => { return arg() })) }) 将args转换为真正的参数
                    element.addEventListener(eventName, (event) => { Reflect.apply(this.mia.method[methodExpression.match(_RegExpPool.extractMethodName)[1]], this.mia.data, [...([].map.call(args, (arg) => arg())), event]) });
                }
            }
        };

        this.trigger = {
            "complexCheckBox": (packet) => { packet.node.addEventListener("click", () => { let value = StrategyPool.val(packet.mia.data, packet.key); if (packet.node.checked) { value.push(packet.node.value) } else { value.indexOf(packet.node.value) != -1 && value.splice(value.indexOf(packet.node.value), 1) } }); },
            "singleCheckBox": (packet) => { packet.node.addEventListener("click", () => { StrategyPool.val(packet.mia.data, packet.key, (packet.node.checked)) }) },
            "radio": (packet) => { packet.node.addEventListener("click", () => { StrategyPool.val(packet.mia.data, packet.key, packet.node.value) }) },
            "common": (packet) => { packet.node.addEventListener("input", () => { StrategyPool.val(packet.mia.data, packet.key, packet.node.value) }) },
            "value": (packet) => { packet.method(packet) }
        };

        this.setter = {
            "complexCheckBox": (packet) => { packet.node.checked = (StrategyPool.val(packet.mia.data, packet.key).indexOf(packet.node.value) != -1) ? "checked" : "" },
            "singleCheckBox": (packet) => { packet.node.checked = (StrategyPool.val(packet.mia.data, packet.key)) ? "checked" : "" },
            "radio": (packet) => { packet.node.checked = (packet.node.value === StrategyPool.val(packet.mia.data, packet.key)) ? "checked" : "" },
            "common": (packet) => { packet.node.value = StrategyPool.val(packet.mia.data, packet.key) },
            "value": (packet) => { packet.node.value = StrategyPool.val(packet.mia.data, packet.key) }
        };
    }

    //将文本节点的处理策略(TextProcessor)注册到策略池(StrategyPool.pool)中
    textNodeRegister(node) {
        const txt = node.textContent; // 永久记录该文本节点的内容初始值
        let tempTxt = node.textContent; // 此处获取该文本节点的内容，用来查询其中出现的所有key，即options中的data字段
        let keys = []; // 当前文本中包含的所有key，即options中的data的字段
        let PcSorCollector = []; // 用于收集每个key对应的处理器集合，相当于二维数组
        while (_RegExpPool.text.test(tempTxt)) {
            let key = _RegExpPool.text.exec(tempTxt)[1].trim();
            if (_RegExpPool.key.test(key)) {//如果是纯字母组合
                let processors = (this.pool[key]) || (this.pool[key] = []);
                keys.push(key);
                PcSorCollector.push(processors);
                // 消除当前key
                tempTxt = tempTxt.replace(new RegExp("\\{\\{\\s?(" + key + "[^\\}\\s]*)\\s?\\}\\}", "gm"), "")
            }
        };
        PcSorCollector.forEach(processors => { processors.push(new TextProcessor(keys, node, txt, this.mia)) });
    }

    elementNodeRegister(element) {
        // 获取该元素上的属性(mia)，如果没有该属性则返回，该元素不是要被处理的元素
        const expression = element.getAttribute("mia");
        if (!expression) return;
        // 解析mia属性的值为map
        let attrs = new Map();
        [].map.call(expression.split(";"),
            subExpression => subExpression.trim().split(":"))
            .forEach(subExpression =>
                attrs.set(subExpression[0] ? subExpression[0].trim() : "error", subExpression[1] ? subExpression[1].trim() : null))

        // 遍历this.specialAttrs，约定的子属性数组
        for (let attr of this.specialAttrs) { attrs.has(attr) && Reflect.apply(this.specialInitMethod[attr], this, [attrs.get(attr), element]) }
    }

    // 通过复杂key(options.data.more.m1)从options.data中对应的字段设置的值
    static val(data, complexKey, newVal) {
        let value = data;
        let hierarchy = complexKey.split(".");
        if (newVal === undefined) {
            for (let index = 0; index < hierarchy.length; index++) {
                let key = hierarchy[index];
                key = /^\d+$/.test(key) ? parseInt(key) : key;
                value = value[key];
                if (value === undefined) return null;
            }
            return value;
        } else {
            StrategyPool.keyOfObj(data, complexKey)[hierarchy.pop()] = newVal;
            return newVal;
        }
    }

    // 获取该复杂key所在的对象
    static keyOfObj(data, complexKey) {
        if (!complexKey) return data;
        let hierarchy = complexKey.split(".");
        let value = data;
        for (let index = 0; index < hierarchy.length - 1; index++) {
            let key = hierarchy[index];
            key = /^\d+$/.test(key) ? parseInt(key) : key;
            value = value[key];
        }
        return value;
    }

    // 每个key对应的策略执行器(processors)集合的的委托执行方法，将会对这个集合中的策略处理器(processor)进行过滤并且执行
    static pcSorProxy(complexKeys, suffix, pool) {
        complexKeys.forEach(complexKey => StrategyPool.pcSorProxySlave(complexKey + suffix, pool))
    }

    static pcSorProxySlave(complexKey, pool) {
        let processors = pool[complexKey]; // 这个key对应的处理器集合
        if (processors) {
            let discard = [];
            for (let index = processors.length - 1; index > -1; index--) {
                const processor = processors[index];
                // 如果该策略处理器不是each的处理器，并且这个策略处理器对应的node已经是被放弃的node，那么记录该策略处理器所在的索引，当循环完毕后，将会根据这些索引将这些策略处理器删除掉
                if (!(processor instanceof EachProcessor) && (processor.node) && (processor.node.__discard__)) {
                    discard.push(index); continue;
                }
                processor.do();
            }
            discard.forEach(index => { processors.splice(index, 1) });// 清除掉要放弃的处理器
        }
    }

    static invalidKey(invalidKey, pool) {
        delete pool[invalidKey];
    }
}

class TextProcessor {
    constructor(keys, node, text, mia) {
        this.node = node;
        this.textSource = text;
        this.keys = keys;
        this.mia = mia
        this.nExps = {};
        this.keys.forEach(key => { this.nExps[key] = new RegExp("\\{\\{\\s?(" + key + "[^\\}\\s]*)\\s?\\}\\}", "gm") });
        this._equalBasis = "TextProcessor";
        this.init();
    }

    do() {
        let text = this.textSource;
        this.keys.forEach(key => {
            let value = StrategyPool.val(this.mia.data, key); value = value === null ? "" : value;
            text = text.replace(this.nExps[key], value)
        })
        this.node.textContent = text;
    }

    init() {
        this.do();
    }
}

class ElementProcessor {
    constructor(key, node, mia, method, initMethod) {
        this.node = node;
        this.key = key;
        this.mia = mia;
        this.method = method;
        this.initMethod = initMethod;
        this._equalBasis = "ElementProcessor" + key;
        this.init();
    }

    do() {
        (this.method) && this.method(this);
    }

    init() {
        this.initMethod(this);
    }
}

class EachProcessor {
    constructor(nodeSource, anchorNode, mia, scope, keyExpression) {
        this.nodeSource = nodeSource;
        this.nodeSource.setAttribute("mia", this.nodeSource.getAttribute("mia").replace(_RegExpPool.eachAttr, ""));
        this.anchorNode = anchorNode;
        this.root = this.anchorNode.parentNode;
        this.generatedNode = {};
        this.mia = mia;
        this.scope = scope;
        this.keyExpression = keyExpression;
        this.nExp = new RegExp(`(\\{{2}\\s?)(${this.keyExpression})([\\.\\w\\d]*)(\\s?\\}{2})`, "gm");
        this.fragment = document.createDocumentFragment();
        this._equalBasis = "EachProcessor";
        this.init();
    }

    do() {
        let eachSource = StrategyPool.val(this.mia.data, this.scope);// 获取被for的对象/数组
        if (!(eachSource instanceof Object)) return;// 如果获取到的值不是一个对象，可能就是单纯的一个值，终止执行
        let nkeys = [].slice.call(Object.keys(eachSource)).filter(key => { return (["push", "__prefix__", "splice", "I_isProxy_I"].indexOf(key) === -1) });
        // 新的对象或数组的key比上一次的少，说明上一次的元素需要清理，这里则是将这些多余的旧key过滤出来，然后移除元素，删除对应的处理器
        let discardKey = [].slice.call(Object.keys(this.generatedNode)).filter(key => { return nkeys.indexOf(key) === -1 });
        if (discardKey) {
            discardKey.forEach(key => {
                let discardNode = this.generatedNode[key];
                EachProcessor.eachDiscard(discardNode);
                discardNode.remove();// todo　可能有浏览器兼容问题
                delete this.generatedNode[key];
                StrategyPool.invalidKey(this.scope + "." + key, this.mia.sp.pool);// todo 在这里移除无效key，有可能引发问题，比如在其他地方也引用了这个key，需要继续判断这个key是否无效
            })
        }
        // 遍历新的对象或数组的所有key，如果这个key已经有一个生成的元素，则保留这个元素，如果新对象的key不存在于旧的对象中，则创建一个新的元素。
        let newNodes = [];
        for (let key of nkeys) {// 对这个对象进行循环，在循环的过程中根据原始的元素克隆出一个新的元素，然后对这个新的元素进行处理，将其中的key替换成其应该引用的key
            // 如果之前生成过一样的元素
            let oldNode = this.generatedNode[key];
            if (oldNode) continue; // todo 如果不创建新的元素，之后是否会有问题，可能需要解决
            let newNode = EachProcessor.eachNode(this.nodeSource.cloneNode(true), this.nExp, key, this.scope, this.keyExpression);
            this.generatedNode[key] = newNode; this.fragment.appendChild(newNode); newNodes.push(newNode);
        }
        this.root.insertBefore(this.fragment, this.anchorNode);
        newNodes.forEach(node => { this.mia.eachNode(node) });
    }


    // todo scope原型
    static eachNode(node, exp, key, scope, keyExpression) {
        let complexKey = scope + "." + key;
        switch (node.nodeType) {
            // 普通元素
            case Node.TEXT_NODE: {
                let text = node.textContent;
                if (_RegExpPool.text.test(text)) node.textContent = text.replace(exp, `$1${complexKey}$3$4`);
                break;
            }
            // 文本节点
            case Node.ELEMENT_NODE: {
                let miaAttr;
                if (miaAttr = node.getAttribute("mia")) node.setAttribute("mia", miaAttr.replace(keyExpression, complexKey));
                break;
            }
        }
        // 递归
        let childNodes;
        if (node.hasChildNodes() && (childNodes = node.childNodes)) {
            for (let index = 0; index < childNodes.length; index++) {
                EachProcessor.eachNode(childNodes[index], exp, key, scope, keyExpression);
            }
        }
        return node;
    }

    static eachDiscard(node) {
        node.__discard__ = true; node.hasChildNodes && (node.childNodes.forEach(node => EachProcessor.eachDiscard(node)));
    }

    init() {
        // this.do();
    }
}