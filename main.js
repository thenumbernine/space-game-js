import {vec3, vec4} from '/js/gl-matrix-3.4.1/index.js';
import {arrayRemove} from '/js/util.js';
import {GLUtil} from '/js/gl-util.js';

const rand = (min, max) => {
	return Math.random() * (max - min) + min
};

let game;
let shotSystem;
let worldBounds;
const glutil = new GLUtil({fullscreen:true});
const gl = glutil.context;

gl.disable(gl.DITHER);
gl.enable(gl.CULL_FACE);
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);	//TODO sort all sprites by z?

const defaultShader = new glutil.Program({
	vertexCode : `
uniform mat4 projMat;
in vec3 vertex;
in vec4 color;
out vec4 colorv;
void main() {
	colorv = color;
	gl_Position = projMat * vec4(vertex, 1.);
}
`,
	fragmentCode : `
in vec4 colorv;
out vec4 fragColor;
void main() {
	fragColor = colorv;
}
`,
});

const maxQuads = 10000;
const quadVertexBuffer = gl.createBuffer();
const quadVertexArray = new Float32Array(maxQuads * 6 * 7);
gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, quadVertexArray, gl.DYNAMIC_DRAW);

gl.useProgram(defaultShader.obj);
// TODO VAO
//gl.enableVertexAttribArray(defaultShader.attrs.vertex.loc);
//gl.enableVertexAttribArray(defaultShader.attrs.color.loc);
gl.vertexAttribPointer(defaultShader.attrs.vertex.loc, 3, gl.FLOAT, false, 7 * 4, 0);
gl.vertexAttribPointer(defaultShader.attrs.color.loc, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
gl.useProgram(null);

let quadIndex = 0;
let frames = 0;
let lastTime = Date.now();
const initDrawFrame = () => {
	{
		frames++;
		const thisTime = Date.now();
		if (thisTime - lastTime > 1000) {
			const fps = frames * 1000 / (thisTime - lastTime);
			//console.log('fps', fps);
			frames = 0;
			lastTime = thisTime;
		}
	}

	quadIndex = 0;
	glutil.scene.setupMatrices();
};

const finishDrawFrame = () => {
	gl.useProgram(defaultShader.obj);
	gl.uniformMatrix4fv(defaultShader.uniforms.projMat.loc, false, glutil.scene.projMat);

	//re-bind the vertex object
	gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
	gl.enableVertexAttribArray(defaultShader.attrs.vertex.loc);
	gl.enableVertexAttribArray(defaultShader.attrs.color.loc);
	gl.vertexAttribPointer(defaultShader.attrs.vertex.loc, 3, gl.FLOAT, false, 7 * 4, 0);
	gl.vertexAttribPointer(defaultShader.attrs.color.loc, 4, gl.FLOAT, false, 7 * 4, 3 * 4);

	gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVertexArray);
	gl.drawArrays(gl.TRIANGLES, 0, quadIndex * 6);
	
	gl.disableVertexAttribArray(defaultShader.attrs.vertex.loc);
	gl.disableVertexAttribArray(defaultShader.attrs.color.loc);
};

//http://lab.concord.org/experiments/webgl-gpgpu/webgl.html
const encodeShader = new glutil.Program({
	vertexCode : `
in vec2 vertex;
in vec2 texCoord;
out vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
`,
	fragmentCode : `
in vec2 pos;
uniform sampler2D tex;

float shift_right(float v, float amt) {
	v = floor(v) + 0.5;
	return floor(v / exp2(amt));
}

float shift_left(float v, float amt) {
	return floor(v * exp2(amt) + 0.5);
}

float mask_last(float v, float bits) {
	return mod(v, shift_left(1.0, bits));
}

float extract_bits(float num, float from, float to) {
	from = floor(from + 0.5);
	to = floor(to + 0.5);
	return mask_last(shift_right(num, from), to - from);
}

vec4 encode_float(float val) {
	if (val == 0.0)
		return vec4(0, 0, 0, 0);
	float sign = val > 0.0 ? 0.0 : 1.0;
	val = abs(val);
	float exponent = floor(log2(val));
	float biased_exponent = exponent + 127.0;
	float fraction = ((val / exp2(exponent)) - 1.0) * 8388608.0;

	float t = biased_exponent / 2.0;
	float last_bit_of_biased_exponent = fract(t) * 2.0;
	float remaining_bits_of_biased_exponent = floor(t);

	float byte4 = extract_bits(fraction, 0.0, 8.0) / 255.0;
	float byte3 = extract_bits(fraction, 8.0, 16.0) / 255.0;
	float byte2 = (last_bit_of_biased_exponent * 128.0 + extract_bits(fraction, 16.0, 23.0)) / 255.0;
	float byte1 = (sign * 128.0 + remaining_bits_of_biased_exponent) / 255.0;
	return vec4(byte4, byte3, byte2, byte1);
}

out vec4 fragColor;
void main() {
	vec4 data = texture(tex, pos);
	fragColor = encode_float(data[0]);
}
`,
	uniforms : {
		tex : 0
	},
});

class ShotSystem {
	constructor() {
		this.texSize = 256;

		const initialDataF32 = new Float32Array(this.texSize * this.texSize * 4);
		for (let i = 0; i < this.texSize * this.texSize * 4; ++i) {
			initialDataF32[i] = Infinity;
		}

		const initialDataI8 = new Uint8Array(this.texSize * this.texSize * 4);
		for (let i = 0; i < this.texSize * this.texSize * 4; ++i) {
			initialDataI8[i] = 0;
		}

		this.posTex = new glutil.Texture2D({
			width : this.texSize,
			height : this.texSize,
			internalFormat : gl.RGBA32F,
			format : gl.RGBA,
			type : gl.FLOAT,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : initialDataF32
		});
		this.velTex = new glutil.Texture2D({
			width : this.texSize,
			height : this.texSize,
			internalFormat : gl.RGBA32F,
			format : gl.RGBA,
			type : gl.FLOAT,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : initialDataF32
		});
		this.accelTex = new glutil.Texture2D({
			width : this.texSize,
			height : this.texSize,
			internalFormat : gl.RGBA32F,
			format : gl.RGBA,
			type : gl.FLOAT,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : initialDataF32
		});
		this.float4ScratchTex = new glutil.Texture2D({
			width : this.texSize,
			height : this.texSize,
			internalFormat : gl.RGBA32F,
			format : gl.RGBA,
			type : gl.FLOAT,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : initialDataF32
		});

		this.reduceTex = new glutil.Texture2D({
			width : this.texSize,
			height : this.texSize,
			internalFormat : gl.RGBA32F,
			format : gl.RGBA,
			type : gl.FLOAT,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : initialDataF32
		});
		this.byte4ScratchTex = new glutil.Texture2D({
			width : this.texSize,
			height : this.texSize,
			internalFormat : gl.RGBA,
			format : gl.RGBA,
			type : gl.UNSIGNED_BYTE,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : initialDataI8
		});
		this.fbo = new glutil.Framebuffer({
			width : this.texSize,
			height : this.texSize
		});
		this.fbo.bind();
		this.fbo.unbind();

		const shotTexSize = 64;
		const shotTexData = new Uint8Array(shotTexSize * shotTexSize * 4);
		{
			let e = 0;
			for (let j = 0; j < shotTexSize; ++j) {
				const y = (j + .5) / shotTexSize;
				const dy = 2 * (y - .5);
				for (let i = 0; i < shotTexSize; ++i) {
					const x = (i + .5) / shotTexSize;
					const dx = 2 * (x - .5);
					const l = Math.sqrt(Math.max(0, 1 - dx*dx - dy*dy));
					shotTexData[e++] = 255;
					shotTexData[e++] = 255;
					shotTexData[e++] = 255;
					shotTexData[e++] = 255 * l;
				}
			}
		}
		this.shotTex = new glutil.Texture2D({
			width : shotTexSize,
			height : shotTexSize,
			internalFormat : gl.RGBA,
			format : gl.RGBA,
			type : gl.UNSIGNED_BYTE,
			minFilter : gl.NEAREST,
			magFilter : gl.LINEAR,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : shotTexData,
		});

		//in absense of PBOs or geom shader, this is what I'm stuck with
		//store a lookup for each tex coord here.  pass it through the shader.
		this.vertexBuffer = gl.createBuffer();
		this.vertexArray = new Float32Array(this.texSize * this.texSize * 2);
		for (let j = 0; j < this.texSize; ++j) {
			for (let i = 0; i < this.texSize; ++i) {
				this.vertexArray[0 + 2 * (i + this.texSize * j)] = (i + .5) / this.texSize;
				this.vertexArray[1 + 2 * (i + this.texSize * j)] = (j + .5) / this.texSize;
			}
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.vertexArray, gl.STATIC_DRAW);

		//quad obj for kernel
		this.quadObj = new glutil.SceneObject({
			mode : gl.TRIANGLE_STRIP,
			attrs : {
				vertex : new glutil.ArrayBuffer({
					dim : 2,
					data : [-1,-1, 1,-1, -1,1, 1,1]
				}),
				texCoord : new glutil.ArrayBuffer({
					dim : 2,
					data : [0,0, 1,0, 0,1, 1,1]
				})
			},
			parent : null,
			static : true
		});

		this.updatePosShader = new glutil.Program({
			vertexCode : `
in vec2 vertex;
in vec2 texCoord;
out vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
`,
			fragmentCode : `
in vec2 pos;
out vec4 fragColor;
uniform sampler2D posTex;
uniform sampler2D velTex;
uniform float dt;
uniform vec3 playerPos;
void main() {
	vec3 oldPos = texture(posTex, pos).xyz;
	vec4 shotVel = texture(velTex, pos);

	vec3 delta = shotVel.xyz * dt;
	vec3 newPos = oldPos + delta;

	float didCollide = 0.;
	float frac = (playerPos.z - oldPos.z) / delta.z;
	if (frac >= 0. && frac <= 1.) {
		vec2 intersect = oldPos.xy + frac * delta.xy;
		vec2 intersectOffset = intersect - playerPos.xy;

		const float playerSize = .5;
		const float shotSize = .1;
		const float intersectCheckSize = .5 * (playerSize + shotSize);
		if (abs(intersectOffset.x) < intersectCheckSize &&
			abs(intersectOffset.y) < intersectCheckSize)
		{
			didCollide = shotVel.w;
		}
	}

	fragColor = vec4(newPos, didCollide);
}
`,
			uniforms : {
				dt : 0,
				posTex : 0,
				velTex : 1
			},
		});

		//just like above except without the collision check
		//TODO separate collision check into its own shader and just use one IntegrateEuler shader?
		// then we wouldn't have to have a separate reduce shader for moving collision flag from 3rd to 0th channel
		//the tradeoff is it would be more tedious to do sweeping collisions
		//-- intentionally keeping track of the last pos tex, or not touching the float4 scratch tex
		this.updateVelShader = new glutil.Program({
			vertexCode : `
in vec2 vertex;
in vec2 texCoord;
out vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
`,
			fragmentCode : `
in vec2 pos;
out vec4 fragColor;
uniform sampler2D velTex;
uniform sampler2D accelTex;
uniform float dt;
void main() {
	//preserve w, the shot's damage
	//store it here because updatePos replaces the w of the pos for the collision flag
	//...though I could separate that in favor of my generic integration kernel
	vec4 vel = texture(velTex, pos);
	vec3 accel = texture(accelTex, pos).xyz;

	vel.xyz += accel * dt;
	fragColor = vel;
}
`,
			uniforms : {
				dt : 0,
				velTex : 0,
				accelTex : 1
			},
		});

		this.collisionReduceFirstShader = new glutil.Program({
			vertexCode : `
in vec2 vertex;
in vec2 texCoord;
out vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
`,
			fragmentCode : `
uniform sampler2D srcTex;
uniform vec2 texsize;
uniform vec2 viewsize;
in vec2 pos;
out vec4 fragColor;
void main() {
	vec2 intPos = pos * viewsize - .5;

	float a = texture(srcTex, (intPos * 2. + .5) / texsize).a;
	float b = texture(srcTex, (intPos * 2. + vec2(1., 0.) + .5) / texsize).a;
	float c = texture(srcTex, (intPos * 2. + vec2(0., 1.) + .5) / texsize).a;
	float d = texture(srcTex, (intPos * 2. + vec2(1., 1.) + .5) / texsize).a;
	float e = a + b;
	float f = c + d;
	float g = e + f;
	fragColor = vec4(g, 0., 0., 0.);
}
`,
		});

		this.collisionReduceShader = new glutil.Program({
			vertexCode : `
in vec2 vertex;
in vec2 texCoord;
out vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
`,
			fragmentCode : `
uniform sampler2D srcTex;
uniform vec2 texsize;
uniform vec2 viewsize;
in vec2 pos;
out vec4 fragColor;
void main() {
	vec2 intPos = pos * viewsize - .5;

	float a = texture(srcTex, (intPos * 2. + .5) / texsize).x;
	float b = texture(srcTex, (intPos * 2. + vec2(1., 0.) + .5) / texsize).x;
	float c = texture(srcTex, (intPos * 2. + vec2(0., 1.) + .5) / texsize).x;
	float d = texture(srcTex, (intPos * 2. + vec2(1., 1.) + .5) / texsize).x;
	float e = max(a,b);
	float f = max(c,d);
	float g = max(e,f);
	fragColor = vec4(g, 0., 0., 0.);
}
`
		});

		this.drawShader = new glutil.Program({
			vertexCode : `
in vec2 vertex;
uniform sampler2D posTex;
uniform mat4 projMat;
uniform float screenWidth;
void main() {
	vec3 pos = texture(posTex, vertex).xyz;
	gl_Position = projMat * vec4(pos, 1.);
	gl_PointSize = .05 / gl_Position.w * screenWidth;
}
`,
			fragmentCode : `
uniform sampler2D shotTex;
out vec4 fragColor;
void main() {
	fragColor = texture(shotTex, gl_PointCoord) * vec4(0., 1., 1., 1.);
}
`,
		});
		gl.useProgram(this.drawShader.obj);
		gl.uniform1i(this.drawShader.uniforms.posTex.loc, 0);
		gl.uniform1i(this.drawShader.uniforms.shotTex.loc, 1);

		gl.useProgram(null);

		this.addCoordX = 0;
		this.addCoordY = 0;
	}

	reset() {
		const initialDataF32 = new Float32Array(this.texSize * this.texSize * 4);
		for (let i = 0; i < this.texSize * this.texSize * 4; ++i) {
			initialDataF32[i] = Infinity;
		}

		gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, initialDataF32);
		gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, initialDataF32);
		gl.bindTexture(gl.TEXTURE_2D, this.accelTex.obj);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, initialDataF32);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	update(dt) {
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.viewport(0, 0, this.texSize, this.texSize);

		//update shot position

		this.fbo.bind();
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.float4ScratchTex.obj, 0);
		//this.fbo.check();

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);

		gl.useProgram(this.updatePosShader.obj);
		gl.uniform1f(this.updatePosShader.uniforms.dt.loc, dt);
		if (game.player !== undefined) {
			gl.uniform3fv(this.updatePosShader.uniforms.playerPos.loc, game.player.pos);
		}

		gl.enableVertexAttribArray(this.updatePosShader.attrs.vertex.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
		gl.vertexAttribPointer(this.updatePosShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.enableVertexAttribArray(this.updatePosShader.attrs.texCoord.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
		gl.vertexAttribPointer(this.updatePosShader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		
		gl.disableVertexAttribArray(this.updatePosShader.attrs.vertex.loc);
		gl.disableVertexAttribArray(this.updatePosShader.attrs.texCoord.loc);


		[this.posTex, this.float4ScratchTex] = [this.float4ScratchTex, this.posTex];
		this.fbo.unbind();

		//update shot velocity

		this.fbo.bind();
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.float4ScratchTex.obj, 0);
		//this.fbo.check();

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.accelTex.obj);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);

		gl.useProgram(this.updateVelShader.obj);
		gl.uniform1f(this.updateVelShader.uniforms.dt.loc, dt);


		gl.enableVertexAttribArray(this.updateVelShader.attrs.vertex.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
		gl.vertexAttribPointer(this.updateVelShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.enableVertexAttribArray(this.updateVelShader.attrs.texCoord.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
		gl.vertexAttribPointer(this.updateVelShader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		
		gl.disableVertexAttribArray(this.updateVelShader.attrs.vertex.loc);
		gl.disableVertexAttribArray(this.updateVelShader.attrs.texCoord.loc);


		[this.velTex, this.float4ScratchTex] = [this.float4ScratchTex, this.velTex];
		this.fbo.unbind();

		//done with texunit1
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, null);

		//now reduce to find if a collision occurred
		//TODO how to do this for all ships, and not just the player?
		// -- how about a low limit on the # of total ships, then just static unrolled for-loop in the shader?

		gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);

		//first shader reads from alpha channel
		let shader = this.collisionReduceFirstShader;

		let size = this.texSize;
		while (size > 1) {
			size /= 2;
			if (size !== Math.floor(size)) throw 'got a npo2 size '+this.nx;
			gl.viewport(0, 0, size, size);

			//bind scratch texture to fbo
			this.fbo.bind();
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.float4ScratchTex.obj, 0);
			//this.fbo.check();

			//setup shader
			gl.useProgram(shader.obj);
			gl.uniform2f(shader.uniforms.texsize.loc, this.texSize, this.texSize);
			gl.uniform2f(shader.uniforms.viewsize.loc, size, size);

			//draw screen quad
			gl.enableVertexAttribArray(shader.attrs.vertex.loc);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
			gl.vertexAttribPointer(shader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
			
			gl.enableVertexAttribArray(shader.attrs.texCoord.loc);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
			gl.vertexAttribPointer(shader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
			
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			
			gl.disableVertexAttribArray(shader.attrs.vertex.loc);
			gl.disableVertexAttribArray(shader.attrs.texCoord.loc);


			//swap current reduce texture and reduce fbo target tex
			[this.float4ScratchTex, this.reduceTex] = [this.reduceTex, this.float4ScratchTex];
			this.fbo.unbind();

			shader = this.collisionReduceShader;

			//bind the last used tex (the reduceTex) to the current input of the next reduction
			gl.bindTexture(gl.TEXTURE_2D, this.reduceTex.obj);
		}

		this.fbo.bind();
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.byte4ScratchTex.obj, 0);
		//this.fbo.check();
		gl.viewport(0, 0, this.texSize, this.texSize);

		gl.useProgram(encodeShader.obj);
		gl.bindTexture(gl.TEXTURE_2D, this.reduceTex.obj);

		
		gl.enableVertexAttribArray(encodeShader.attrs.vertex.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
		gl.vertexAttribPointer(encodeShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.enableVertexAttribArray(encodeShader.attrs.texCoord.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
		gl.vertexAttribPointer(encodeShader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		
		gl.disableVertexAttribArray(encodeShader.attrs.vertex.loc);
		gl.disableVertexAttribArray(encodeShader.attrs.texCoord.loc);


		const uint8Result = new Uint8Array(4);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, uint8Result);

		this.fbo.unbind();

		const float32Result = new Float32Array(uint8Result.buffer);
		gl.viewport(0, 0, this.nx, this.nx);
		const result = float32Result[0];

		if (result > 0) {
			if (game.player !== undefined) {
				game.player.takeDamage(result, undefined, undefined);
			}
		}

		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.viewport(0, 0, glutil.canvas.width, glutil.canvas.height);

		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.BLEND);
		gl.enable(gl.CULL_FACE);

		gl.useProgram(defaultShader.obj);
	}

	add(damage, newShotPos, newShotVel, newShotAccel) {
		//writing a single pixel
		// which is faster?  fbo with a 1-pixel viewport, or texsubimage of 1 pixel?
		gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, this.addCoordX, this.addCoordY, 1, 1, gl.RGBA, gl.FLOAT, vec4.fromValues(newShotPos[0], newShotPos[1], newShotPos[2], 0));
		gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, this.addCoordX, this.addCoordY, 1, 1, gl.RGBA, gl.FLOAT, vec4.fromValues(newShotVel[0], newShotVel[1], newShotVel[2], damage));
		gl.bindTexture(gl.TEXTURE_2D, this.accelTex.obj);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, this.addCoordX, this.addCoordY, 1, 1, gl.RGBA, gl.FLOAT, vec4.fromValues.apply(vec4, newShotAccel));
		gl.bindTexture(gl.TEXTURE_2D, null);

		//increment pointer in the framebuffer
		++this.addCoordX;
		if (this.addCoordX < this.texSize) return;
		this.addCoordX = 0;
		++this.addCoordY;
		if (this.addCoordY < this.texSize) return;
		this.addCoordY = 0;
	}

	draw() {
		//bind the texcoord buffer, use the draw shader to override the vertex data with the position texture data
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		gl.disable(gl.DEPTH_TEST);

		gl.useProgram(this.drawShader.obj);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.shotTex.obj);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);

		gl.uniformMatrix4fv(this.drawShader.uniforms.projMat.loc, false, glutil.scene.projMat);
		gl.uniform1f(this.drawShader.uniforms.screenWidth.loc, glutil.canvas.width);
		
		gl.enableVertexAttribArray(this.drawShader.attrs.vertex.loc);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.vertexAttribPointer(this.drawShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
		
		gl.drawArrays(gl.POINTS, 0, this.texSize * this.texSize);
		
		gl.disableVertexAttribArray(this.drawShader.attrs.vertex.loc);

		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, null);

		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.DEPTH_TEST);
	}
}

/*let*/ shotSystem = new ShotSystem();

const drawQuad = (pos, color, scale) => {
	if (quadIndex >= maxQuads) return;
	scale *= .5;
	let g = quadIndex * 6 * 7;

	//vertices
	//colors

	quadVertexArray[g++] = pos[0] - scale;
	quadVertexArray[g++] = pos[1] - scale;
	quadVertexArray[g++] = pos[2];
	quadVertexArray[g++] = color[0];
	quadVertexArray[g++] = color[1];
	quadVertexArray[g++] = color[2];
	quadVertexArray[g++] = color[3];

	quadVertexArray[g++] = pos[0] + scale;
	quadVertexArray[g++] = pos[1] - scale;
	quadVertexArray[g++] = pos[2];
	quadVertexArray[g++] = color[0];
	quadVertexArray[g++] = color[1];
	quadVertexArray[g++] = color[2];
	quadVertexArray[g++] = color[3];

	quadVertexArray[g++] = pos[0] + scale;
	quadVertexArray[g++] = pos[1] + scale;
	quadVertexArray[g++] = pos[2];
	quadVertexArray[g++] = color[0];
	quadVertexArray[g++] = color[1];
	quadVertexArray[g++] = color[2];
	quadVertexArray[g++] = color[3];

	quadVertexArray[g++] = pos[0] + scale;
	quadVertexArray[g++] = pos[1] + scale;
	quadVertexArray[g++] = pos[2];
	quadVertexArray[g++] = color[0];
	quadVertexArray[g++] = color[1];
	quadVertexArray[g++] = color[2];
	quadVertexArray[g++] = color[3];

	quadVertexArray[g++] = pos[0] - scale;
	quadVertexArray[g++] = pos[1] + scale;
	quadVertexArray[g++] = pos[2];
	quadVertexArray[g++] = color[0];
	quadVertexArray[g++] = color[1];
	quadVertexArray[g++] = color[2];
	quadVertexArray[g++] = color[3];

	quadVertexArray[g++] = pos[0] - scale;
	quadVertexArray[g++] = pos[1] - scale;
	quadVertexArray[g++] = pos[2];
	quadVertexArray[g++] = color[0];
	quadVertexArray[g++] = color[1];
	quadVertexArray[g++] = color[2];
	quadVertexArray[g++] = color[3];


	++quadIndex;
};

//game

//let Player;
//let Enemy;
//let GroupEnemy;
//let TurretEnemy;
//let Star;

class Game {
	constructor() {
		this.reset();
	}
	//call after init and assignment of 'game' global
	start() {
		for (let i = 0; i < this.maxStars; ++i) {
			new Star();	//auto adds to game.stars
		}
		this.player = new Player({
			pos : vec3.fromValues(0,0,-5)
		});
	}
	reset () {
		this.objs = [];
		this.stars = [];	//update separately to not clog up the touch tests
		this.time = 0;
		this.nextEnemyTime = 3;
	}
	update(dt) {
		//update
		for (let i = 0; i < this.objs.length; ++i) {
			this.objs[i].update(dt);
		}
		for (let i = 0; i < this.stars.length; ++i) {
			this.stars[i].update(dt);
		}
		for (let i = this.objs.length-1; i >= 0; --i) {
			if (this.objs[i].remove) {
				this.objs.splice(i, 1);
			}
		}

		//game logic: add extra enemies
		if (this.time >= this.nextEnemyTime) {
			this.nextEnemyTime = this.time + 3;

			if (true) {	//TurretEnemy
				new TurretEnemy({
					pos : vec3.fromValues(
						rand(worldBounds.min[0] + 2, worldBounds.max[0] - 2),
						worldBounds.min[1],
						worldBounds.min[2] + 1),
					vel : vec3.fromValues(0, 0, 5)
				});
			}

			if (true) {	//GroupEnemy

				const theta = Math.random() * Math.PI * 2;
				const vel = vec3.fromValues(Math.cos(theta), Math.sin(theta), 1);
				const groupCenter = vec3.fromValues(
					rand(worldBounds.min[0] + 2, worldBounds.max[0] - 2),
					rand(worldBounds.min[1] + 2, worldBounds.max[1] - 2),
					worldBounds.min[2] + 1);
				const spread = 1.5;
				const waveSize = Math.floor(rand(2,6));
				const group = [];
				for (let i = 0; i < waveSize; ++i) {
					const groupAngle = i / waveSize * Math.PI * 2;
					const enemy = new GroupEnemy({
						group : group,
						pos : vec3.fromValues(
							groupCenter[0] + spread * Math.cos(groupAngle),
							groupCenter[1] + spread * Math.sin(groupAngle),
							groupCenter[2]),
						vel : vel
					});
					group.push(enemy);
				}
				for (let i = 0; i < group.length; ++i) {
					group[i].groupInit();
				}

			}
		}

		this.time += dt;
	}
	draw() {
		initDrawFrame();
		for (let i = 0; i < this.stars.length; ++i) {
			this.stars[i].draw();
		}
		for (let i = this.objs.length-1; i >= 0; --i) {
			this.objs[i].draw();
		}
		finishDrawFrame();
	}
}
Game.prototype.maxStars = 100;

/*let*/ worldBounds = {
	min : vec3.fromValues(-10, -10, -50),
	max : vec3.fromValues(10, 10, -4)
};

class Star {
	constructor() {
		this.pos = vec3.create();
		this.resetXY();
		this.pos[2] = rand(this.zMin, this.zMax);
		game.stars.push(this);
	}
	resetXY() {
		const angle = Math.random() * Math.PI * 2;
		const maxBounds = Math.max(worldBounds.max[0], worldBounds.max[1]);
		const r = rand(maxBounds * 10, maxBounds * 30);
		this.pos[0] = Math.cos(angle) * r;
		this.pos[1] = Math.sin(angle) * r;
	}
	update(dt) {
		this.pos[2] += dt * this.starfieldVelocity;
		if (this.pos[2] > this.zMax) {
			this.pos[2] -= this.zMax - this.zMin;
			this.resetXY();
		}
	}
	draw() {
		drawQuad(this.pos, this.color, this.scale);
	}
}
Star.prototype.starfieldVelocity = 200;
Star.prototype.color = vec4.fromValues(1,1,1,1);
Star.prototype.scale = 1;
Star.prototype.zMin = worldBounds.min[2] * 10;
Star.prototype.zMax = worldBounds.max[2] + 10;

const mightTouchObj = [];
const mightTouchFrac = [];
let mightTouchLength = 0;
class GameObject {
	constructor(args) {
		this.pos = vec3.create();
		this.vel = vec3.create();
		if (args !== undefined) {
			if (args.pos !== undefined) vec3.copy(this.pos, args.pos);
			if (args.vel !== undefined) vec3.copy(this.vel, args.vel);
			if (args.color !== undefined) this.color = vec4.clone(args.color);
		}
		game.objs.push(this);
	}
	update(dt) {
		//trace movement
		const startX = this.pos[0];
		const startY = this.pos[1];
		const startZ = this.pos[2];

		const deltaX = this.vel[0] * dt;
		const deltaY = this.vel[1] * dt;
		const deltaZ = this.vel[2] * dt;

		let destX = startX + deltaX;
		let destY = startY + deltaY;
		let destZ = startZ + deltaZ;

		if (this.touch) {
			mightTouchLength = 0;
			for (let i = 0; i < game.objs.length; ++i) {
				const o = game.objs[i];
				if (o.remove) continue;
				if (o == this) continue;

				//for now assume we're quads ...
				const frac = (o.pos[2] - startZ) / deltaZ;
				if (frac < 0 || frac > 1) continue;

				const x = startX + frac * deltaX;
				const y = startY + frac * deltaY;
				const dx = x - o.pos[0];
				const dy = y - o.pos[1];
				if (Math.abs(dx) < (this.scale + o.scale) * .5 &&
					Math.abs(dy) < (this.scale + o.scale) * .5)
				{
					mightTouchObj[mightTouchLength] = o;
					mightTouchFrac[mightTouchLength] = frac;
					++mightTouchLength;
				}
			}
			//got all objects in our collision hull
			//sort by fraction and check touch with each
			if (mightTouchLength > 0) {
				//small arrays, bubble sort has faster time
				//that and I am sorting two arrays at once, so to use js sort i would merge them into one array
				let swapped;
				do {
					swapped = false;
					for (let i = 1; i < mightTouchLength; ++i) {
						if (mightTouchFrac[i-1] > mightTouchFrac[i]) {
							[mightTouchFrac[i-1], mightTouchFrac[i]] = [mightTouchFrac[i], mightTouchFrac[i-1]];
							[mightTouchObj[i-1], mightTouchObj[i]] = [mightTouchObj[i], mightTouchObj[i-1]];
							swapped = true;
						}
					}
				} while (swapped);
				//mightTouch.sort((a,b) => { return a.frac - b.frac; });

				for (let i = 0; i < mightTouchLength; ++i) {
					const o = mightTouchObj[i];
					const f = mightTouchFrac[i];
					this.pos[0] = startX + deltaX * f;
					this.pos[1] = startY + deltaY * f;
					this.pos[2] = startZ + deltaZ * f;
					const stopped = this.touch(o);
					if (this.remove) return;
					if (stopped) {
						destX = this.pos[0];
						destY = this.pos[1];
						destZ = this.pos[2];
						break;
					}
				}
			}
		}

		this.pos[0] = destX;
		this.pos[1] = destY;
		this.pos[2] = destZ;

		if (this.removeWhenOOB) {
			if (this.pos[0] < worldBounds.min[0] || this.pos[0] > worldBounds.max[0] ||
				this.pos[1] < worldBounds.min[1] || this.pos[1] > worldBounds.max[1] ||
				this.pos[2] < worldBounds.min[2] || this.pos[2] > worldBounds.max[2])
			{
				this.remove = true;
				return;
			}
		} else {
			if (this.pos[0] < worldBounds.min[0]) this.pos[0] = worldBounds.min[0];
			if (this.pos[0] > worldBounds.max[0]) this.pos[0] = worldBounds.max[0];
			if (this.pos[1] < worldBounds.min[1]) this.pos[1] = worldBounds.min[1];
			if (this.pos[1] > worldBounds.max[1]) this.pos[1] = worldBounds.max[1];
			if (this.pos[2] < worldBounds.min[2]) this.pos[2] = worldBounds.min[2];
			if (this.pos[2] > worldBounds.max[2]) this.pos[2] = worldBounds.max[2];
		}
	}
	draw() {
		drawQuad(this.pos, this.color, this.scale);
	}
}
GameObject.prototype.color = vec4.fromValues(1,1,1,1);
GameObject.prototype.scale = 1;

class Shot extends GameObject {
	constructor(args, ...rest) {
		super(args, ...rest);
		//this.life = 20;
		if (args !== undefined) {
			if (args.owner !== undefined) {
				this.owner = args.owner;
				vec3.copy(this.pos, args.owner.pos);
			}
		}
	}
	update(dt, ...rest) {
		super.update(dt, ...rest);
		/*this.life = this.life - dt;
		if (this.life <= 0) {
			this.remove = true;
			return;
		}*/
	}
	touch(other) {
		if (other == this.owner) return false;
		if (!other.takeDamage) return false;	//return other.collides;  so objects can block shots even if they're not taking damage
		other.takeDamage(this.damage, this, this.owner);
		this.remove = true;
		return true;
	}
}
Shot.prototype.color = vec4.fromValues(0,1,1,1);
Shot.prototype.scale = .3;
Shot.prototype.damage = 1;
Shot.prototype.removeWhenOOB = true;


class Shrapnel extends GameObject {
	constructor(args, ...rest) {
		super(args, ...rest);
		this.vel[0] = rand(-5, 5);
		this.vel[1] = rand(-5, 5);
		this.vel[2] = rand(-5, 5);
		this.life = rand(.5, 1.5);
		this.scale = rand(.25, .75) * rand(.25, .75);
		vec3.scale(this.vel, this.vel, 2 / (this.scale * vec3.length(this.vel)));	//smaller chunks go further
	}
	update(dt, ...rest) {
		super.update(dt, ...rest);
		this.life -= dt;
		if (this.life < 0) this.remove = true;
	}
}
Shrapnel.prototype.scale = .1;

class BasicShotWeapon {
	constructor(args) {
		this.nextShotTime = 0;
		if (args !== undefined) {
			if (args.owner !== undefined) this.owner = args.owner;
		}
	}
	shoot(vx, vy, vz, ax, ay, az) {
		if (game.time < this.nextShotTime) return;
		this.nextShotTime = game.time + this.reloadTime;	//reload time

		if (this.owner == game.player) {
			//create shots for the player
			new Shot({
				owner : this.owner,
				vel : vec3.fromValues(vx, vy, vz)
				//TODO accel support for player shots
			});
		} else {
			shotSystem.add(
				Shot.prototype.damage,
				this.owner.pos,
				vec3.fromValues(vx, vy, vz),
				vec3.fromValues(ax, ay, az));
		}
	}

}
BasicShotWeapon.prototype.reloadTime = .1;

class Ship extends GameObject {
	constructor(args, ...rest) {
		super(args, ...rest);
		this.health = this.maxHealth;
		if (args !== undefined) {
			if (args.health !== undefined) this.health = args.health;
		}
	}
	takeDamage(damage, inflicter, attacker) {
		this.health -= damage;

		for (let i = 0; i < 20; ++i) {
			new Shrapnel({
				pos : this.pos
			});
		}

		if (this.health <= 0) this.die(inflicter, attacker);
	}
	die(inflicter, attacker) {
		this.remove = true;
	}
}
Ship.prototype.removeWhenOOB = true;
Ship.prototype.maxHealth = 1;

class Enemy extends Ship {
}

class TurretEnemy extends Enemy {
	update(...rest) {
		super.update(...rest);

		//can shoot again
		if (game.time > this.nextShotTime) {
			this.nextShotTime = game.time + 3;
			this.shootState = 1;
		}

		if (this.shootState) {
			const speed = 5;

			//fire off a few shots
			let dx = 0;
			let dy = 0;
			let dz = 1;

			if (game.player !== undefined) {
				dx = game.player.pos[0] - this.pos[0];
				dy = game.player.pos[1] - this.pos[1];
				dz = game.player.pos[2] - this.pos[2];
				const s = 1/Math.sqrt(dx * dx + dy * dy + dz * dz);
				dx *= s;
				dy *= s;
				dz *= s;
			}

			//d cross x
			let bx = 0;
			let by = dz;
			let bz = -dy;
			{
				const l = 1/Math.sqrt(dy * dy + dz * dz);
				by *= l;
				bz *= l;
			}

			//(d cross x) cross d
			let ax = by * dz - bz * dy;
			let ay = bz * dx - bx * dz;
			let az = bx * dy - by * dx;
			{
				const l = 1/Math.sqrt(ax * ax + ay * ay + az * az);
				ax *= l;
				ay *= l;
				az *= l;
			}

			const iMaxRadius = 5;
			//for (let iradius = 0; iradius < iMaxRadius; ++iradius)
			{
				const iradius = this.shootState - 1;
				const iMaxTheta = 2 * iradius * iradius + 1;
				const radius = iradius / iMaxRadius;

				for (let itheta = 0; itheta < iMaxTheta; ++itheta) {
					const theta = (itheta + .5) / iMaxTheta * Math.PI * 2;
					const u = Math.cos(theta) * radius;
					const v = Math.sin(theta) * radius;

					//TODO calc so that all shots meet at player at the same time despite 1/30 frame delay between them
					const accelPerp = 0;//.25 * radius;
					const accelTang = 0;//.25 * radius;
					const accel = vec3.fromValues(
						dx * accelPerp + accelTang * (ax * u + bx * v),
						dy * accelPerp + accelTang * (ay * u + by * v),
						dz * accelPerp + accelTang * (az * u + bz * v));

					shotSystem.add(
						Shot.prototype.damage,
						vec3.fromValues(
							this.pos[0] + ax * u + bx * v,
							this.pos[1] + ay * u + by * v,
							this.pos[2] + az * u + bz * v),
						vec3.fromValues(dx * speed, dy * speed, dz * speed),
						accel);
				}
			}
			this.shootState = this.shootState + 1;
			if (this.shootState == iMaxRadius) this.shootState = 0;	//stop condition
		}
	}
}
TurretEnemy.prototype.color = vec4.fromValues(1,0,0,1);
TurretEnemy.prototype.nextShotTime = 0;
TurretEnemy.prototype.shootState = 0;

class GroupEnemy extends Enemy {
	constructor(args, ...rest) {
		super(args, ...rest);
		if (args !== undefined) {
			if (args.group !== undefined) this.group = args.group;
		}
		this.weapon = new BasicShotWeapon({
			owner : this
		});
	}
	groupInit() {
		if (this.group !== undefined) {
			this.groupCenter = vec3.create();
			this.updateGroupCenter();
			const deltaX = this.pos[0] - this.groupCenter[0];
			const deltaY = this.pos[1] - this.groupCenter[1];
			this.vel[0] += -deltaY;
			this.vel[1] += deltaX;
		}
	}
	updateGroupCenter() {
		this.groupCenter[0] = 0;
		this.groupCenter[1] = 0;
		this.groupCenter[2] = 0;
		for (let i = 0; i < this.group.length; ++i) {
			vec3.add(this.groupCenter, this.groupCenter, this.group[i].pos);
		}
		vec3.scale(this.groupCenter, this.groupCenter, 1/this.group.length);
	}
	update(dt, ...rest) {
		super.update(dt, ...rest);

		/* a few acceleration tricks ...

		intersect with player:
		pi = initial shot position
		vi = initial shot velocity
		a = shot acceleration

		pf = final shot position = player position
		vf = final shot velocity

		px = pxi + vxi * t + 1/2 ax * t^2
		py = pyi + vyi * t + 1/2 ay * t^2
		pz = pzi + vzi * t + 1/2 az * t^2

		1/2 az t^2 + vzi t + pzi - pzf = 0
		t = [-vzi +- sqrt(vzi^2 - az*(pzi-pzf)]/(az)
		except when az = 0 we get
		pzf = pzi + vzi * t	<- time to final z position
		t = (pzf - pzi) / vzi

		pxf = pxi + vxi * t + 1/2 axi * t^2
		1/2 axi * t^2 = pxf - pxi - vxi * t
		axi = 2 * (pxf - pxi) / t^2 - 2 * vxi / t
		*/
		let vz = 15;
		let vx = 0;
		let vy = 0;

		let ax = 0;
		let ay = 0;
		let az = 0;
		/*homing
		if (game.player !== undefined) {
			let t = (game.player.pos[2] - this.pos[2]) / vz;
			ax = 2 * ((game.player.pos[0] - this.pos[0]) / t - vx) / t;
			ay = 2 * ((game.player.pos[1] - this.pos[1]) / t - vy) / t;
		}
		*/
		this.weapon.shoot(vx, vy, vz, ax, ay, 0);

		if (this.group !== undefined && this.group.length > 1) {
			// do some cool BOIDs routine
			this.updateGroupCenter();
			//now ... spin around it!
			const deltaX = this.groupCenter[0] - this.pos[0];
			const deltaY = this.groupCenter[1] - this.pos[1];
			const deltaZ = this.groupCenter[2] - this.pos[2];
			this.vel[0] += deltaX * .1;
			this.vel[1] += deltaY * .1;
			this.vel[2] += deltaZ * .1;
		}
	}
	die(...rest) {
		super.die(...rest);
		if (this.group !== undefined) {
			arrayRemove.call(this.group, this);
		}
	}
}
GroupEnemy.prototype.color = vec4.fromValues(1,0,1,1);

class Player extends Ship {
	constructor(...rest) {
		super(...rest);
		this.targetPos = vec3.create();
		this.aimPos = vec3.create();
		this.aimPos[2] = worldBounds.min[2];
		this.speed = 10;
		this.weapon = new BasicShotWeapon({
			owner : this
		});
	}
	update(dt, ...rest) {
		//determine velocity
		this.vel[0] *= .5;
		this.vel[1] *= .5;
		this.vel[2] *= .5;
		let deltaX = this.targetPos[0] - this.pos[0];
		let deltaY = this.targetPos[1] - this.pos[1];
		let deltaZ = this.targetPos[2] - this.pos[2];
		const deltaLenSq = deltaX*deltaX + deltaY*deltaY + deltaZ*deltaZ;
		if (deltaLenSq > .01*.01) {
			const movement = this.speed * dt;
			if (deltaLenSq < movement * movement) {
				vec2.copy(this.pos, this.targetPos);
			} else {
				const deltaLen = Math.sqrt(deltaLenSq);
				const s = this.speed/deltaLen;	//don't factor in dt ... that'll be done by integration
				deltaX *= s;
				deltaY *= s;
				deltaZ *= s;
				this.vel[0] = deltaX;
				this.vel[1] = deltaY;
				//this.pos[2] += deltaZ;
			}
		}

		//integrate
		super.update(dt, ...rest);

		if (this.shooting) {
			const velX = this.aimPos[0] - this.pos[0];
			const velY = this.aimPos[1] - this.pos[1];
			const velZ = this.aimPos[2] - this.pos[2];
			const speed = 20;
			const scalar = speed / Math.sqrt(velX*velX + velY*velY + velZ*velZ);
			this.weapon.shoot(velX*scalar, velY*scalar, velZ*scalar, 0,0,0);
		}
	}
	takeDamage(damage, inflicter, attacker, ...rest) {
		super.takeDamage(damage, inflicter, attacker, ...rest);
		console.log('hit and at',this.health);
	}
	die(inflicter, attacker, ...rest) {
		//add lots of explosion bits
		const r = Math.random();
		const g = Math.random() * r;
		const b = Math.random() * g;
		for (let i = 0; i < 20; ++i) {
			new Shrapnel({
				pos : this.pos,
				color : vec4.fromValues(r,g,b,1)
			});
		}

		super.die(inflicter, attacker, ...rest);
		game.player = undefined;
		//restart the game
		setTimeout(() => {
			//I was just creating a new game, but Chrome leaked badly and the framerate of the subsequent games got kicked down a big percent each time.
			game.reset();
			shotSystem.reset();
			game.start();
		}, 5000);
	}
}
Player.prototype.color = vec4.fromValues(1,1,0,.75);
Player.prototype.maxHealth = 20;
Player.prototype.removeWhenOOB = false;

/*let*/ game = new Game();
game.start();
shotSystem.reset();

//update loop
const update = () => {
	//
	const dt = 1/30;

	shotSystem.update(dt);

	//update game objects
	game.update(dt);

	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	shotSystem.draw();
	game.draw();

	//test
	//the renderr goes very fast.  20k quads at 60fps only because it was vsync'd
	//the slowdown is from the game update
	/*
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	initDrawFrame();
	for (let i = 0; i < maxQuads; ++i) {
		drawQuad(
			[rand(-5,5), rand(-5,5), rand(-50,-5)],
			[Math.random(), Math.random(), Math.random(), Math.random()],
			1);
	}
	finishDrawFrame();
	*/

	requestAnimationFrame(update);
};
//update();
requestAnimationFrame(update);

//mouse input
const movePlayer = (xf, yf) => {
	if (game.player === undefined) return;
	const aspectRatio = glutil.canvas.width / glutil.canvas.height;
	const targetScale = -game.player.pos[2];
	game.player.targetPos[0] = (xf * 2 - 1) * aspectRatio * targetScale;
	game.player.targetPos[1] = (1 - yf * 2) * targetScale;
	game.player.aimPos[0] = game.player.targetPos[0];
	game.player.aimPos[1] = game.player.targetPos[0];
};
const aimPlayer = (xf, yf) => {
	if (game.player === undefined) return;
	const aspectRatio = glutil.canvas.width / glutil.canvas.height;
	const targetScale = -game.player.pos[2];
	game.player.aimPos[0] = (xf * 2 - 1) * aspectRatio * targetScale;
	game.player.aimPos[1] = (1 - yf * 2) * targetScale;
	//exhaggerate
	const exhaggeration = 5;
	game.player.aimPos[0] += (game.player.aimPos[0] - game.player.targetPos[0]) * exhaggeration + game.player.targetPos[0];
	game.player.aimPos[1] += (game.player.aimPos[1] - game.player.targetPos[1]) * exhaggeration + game.player.targetPos[1];
};
const handleInputEvent = e => {
	const xf = e.pageX / window.innerWidth;
	const yf = e.pageY / window.innerHeight;
	if (e.shiftKey) {
		aimPlayer(xf, yf);
	} else {
		movePlayer(xf, yf);
	}
};
window.addEventListener('mousemove', e => {
	handleInputEvent(e);
});
window.addEventListener('mousedown', e => {
	if (game.player !== undefined) game.player.shooting = true;
});
window.addEventListener('mouseup', e => {
	if (game.player !== undefined) game.player.shooting = false;
});
window.addEventListener('touchmove', e => {
	handleInputEvent(e.originalEvent.changedTouches[0]);
});
window.addEventListener('touchstart', e => {
	if (game.player !== undefined) game.player.shooting = true;
});
window.addEventListener('touchend', e => {
	if (game.player !== undefined) game.player.shooting = false;
});
window.addEventListener('touchcancel', e => {
	if (game.player !== undefined) game.player.shooting = false;
});
